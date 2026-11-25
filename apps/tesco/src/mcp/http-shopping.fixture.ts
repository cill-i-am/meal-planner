import { Effect, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { TescoAuthSession } from "../auth/auth-session.port.js";
import { TescoAuthorizationValue } from "../auth/auth.model.js";
import { TescoAuthenticatedGraphQlTransport } from "../catalogue/authenticated-graphql-transport.port.js";
import * as Shopping from "../shopping/shopping.model.js";
import { makeTescoXapiShopping } from "../shopping/xapi-shopping.js";
import type {
  SavedCheckoutReview,
  ShoppingCommandRecord,
  TescoShoppingStorage,
} from "../shopping/xapi-shopping.js";
import { TescoApiKeyValue, TescoLocale, TescoRegion } from "../tesco.config.js";

/** Real shopping policy and receipts; only the Tesco network and native storage are substituted. */
export const makeHttpShoppingFixture = () => {
  const slot = Schema.decodeUnknownSync(Shopping.DeliverySlot)({
    charge: 3,
    end: "2026-10-24T12:00:00Z",
    expiry: null,
    group: 0,
    id: "available-slot",
    locationUuid: "location",
    reservationExpiry: null,
    start: "2026-10-24T10:00:00Z",
    status: "Available",
  });
  let basket = Schema.decodeUnknownSync(Shopping.Basket)({
    charges: { depositCharge: 0, minimum: 0, surcharge: 0 },
    guidePrice: 2,
    id: "basket",
    isInAmend: false,
    items: [
      {
        cost: 2,
        id: "line",
        product: {
          id: "123",
          price: null,
          productType: "SingleProduct",
          title: "Milk",
        },
        quantity: 1,
        substitutionOption: null,
        unit: "pcs",
        weight: null,
      },
    ],
    localisation: { currency: { iso: "EUR" } },
    orderId: null,
    shoppingMethod: "delivery",
    slot: { ...slot, id: "reserved-slot", status: "Reserved" },
    totalItems: 1,
    totalPrice: 2,
  });
  const records = new Map<string, typeof ShoppingCommandRecord.Type>();
  let review: Option.Option<typeof SavedCheckoutReview.Type> = Option.none();
  const storage: TescoShoppingStorage = {
    readCommand: (id) =>
      Effect.sync(() => Option.fromUndefinedOr(records.get(id))),
    readReview: Effect.sync(() => review),
    writeCommand: (id, value) =>
      Effect.sync(() => {
        records.set(id, value);
      }),
    writeReview: (value) =>
      Effect.sync(() => {
        review = Option.some(value);
      }),
  };
  const sent: string[] = [];
  let unauthorized = false;
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      if (request.body._tag !== "Uint8Array") {
        throw new Error("Expected a JSON command");
      }
      const input = Schema.decodeUnknownSync(
        Schema.Struct({
          operationName: Schema.String,
          variables: Schema.Record(Schema.String, Schema.Json),
        })
      )(JSON.parse(new TextDecoder().decode(request.body.body)));
      sent.push(input.operationName);
      if (unauthorized) {
        return HttpClientResponse.fromWeb(
          request,
          new Response(null, { status: 401 })
        );
      }
      if (input.operationName === "SetPrivateBasketItems") {
        const { items } = Schema.decodeUnknownSync(
          Schema.Struct({
            items: Schema.Array(
              Schema.Struct({ id: Schema.String, newValue: Schema.Number })
            ),
          })
        )(input.variables);
        basket = {
          ...basket,
          items: basket.items
            .map((line) => ({
              ...line,
              quantity:
                items.find((item) => item.id === line.product.id)?.newValue ??
                line.quantity,
            }))
            .filter((line) => line.quantity > 0),
        };
      } else if (input.operationName === "ReservePrivateSlot") {
        basket = {
          ...basket,
          slot: { ...slot, id: "reserved-slot", status: "Reserved" },
        };
      } else if (input.operationName === "ReleasePrivateSlot") {
        basket = { ...basket, slot: null };
      }
      return HttpClientResponse.fromWeb(
        request,
        Response.json({
          data: input.operationName.includes("Slot")
            ? {
                fulfilment: {
                  slot: basket.slot === null ? null : { id: basket.slot.id },
                },
              }
            : { basket: { id: basket.id } },
        })
      );
    })
  );
  const page = { count: 0, page: 1, pageSize: 10, total: 0 };
  const program = makeTescoXapiShopping(
    {
      locale: Schema.decodeUnknownSync(TescoLocale)("en-IE"),
      mangoApiKey: Redacted.make(
        Schema.decodeUnknownSync(TescoApiKeyValue)("test-api-key")
      ),
      mangoUrl: new URL("https://xapi.tesco.com/"),
      region: Schema.decodeUnknownSync(TescoRegion)("IE"),
      releaseBranch: null,
      suggestionUrl: new URL("https://search.api.tesco.com/search/suggestion/"),
      transactionPurpose: null,
    },
    storage
  ).pipe(
    Effect.provideService(HttpClient.HttpClient, client),
    Effect.provideService(TescoAuthSession, {
      authorization: Effect.succeed(
        Redacted.make(
          Schema.decodeUnknownSync(TescoAuthorizationValue)(
            "Bearer test-access"
          )
        )
      ),
      refreshAfterUnauthorized: () =>
        Effect.die("Mutations cannot refresh and replay"),
    }),
    Effect.provideService(TescoAuthenticatedGraphQlTransport, {
      execute: (operation) =>
        Effect.sync(() => {
          switch (operation.read.operationName) {
            case "GetPrivateBasket": {
              return { data: { basket } };
            }
            case "GetPrivateProduct": {
              return { data: { product: null } };
            }
            case "GetPrivateOrder": {
              return { data: { order: null } };
            }
            case "GetPrivateFavourites": {
              return { data: { favourites: { info: page, products: [] } } };
            }
            case "GetPrivatePreviousOrders": {
              return { data: { orderSearch: { info: page, orders: [] } } };
            }
            default: {
              return { data: { delivery: [slot] } };
            }
          }
        }),
    })
  );
  return {
    program,
    sent,
    setUnauthorized: () => {
      unauthorized = true;
    },
    slot,
  };
};
