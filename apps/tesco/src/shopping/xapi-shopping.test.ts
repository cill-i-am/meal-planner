import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";

import { TescoAuthSession } from "../auth/auth-session.port.js";
import { TescoAuthorizationValue } from "../auth/auth.model.js";
import { TescoAuthenticatedGraphQlTransport } from "../catalogue/authenticated-graphql-transport.port.js";
import { TescoApiKeyValue, TescoLocale, TescoRegion } from "../tesco.config.js";
import * as Model from "./shopping.model.js";
import { makeTescoXapiShopping } from "./xapi-shopping.js";
import type {
  SavedCheckoutReview,
  ShoppingCommandRecord,
  TescoShoppingStorage,
} from "./xapi-shopping.js";

const config = {
  locale: Schema.decodeUnknownSync(TescoLocale)("en-IE"),
  mangoApiKey: Redacted.make(
    Schema.decodeUnknownSync(TescoApiKeyValue)("test-api-key")
  ),
  mangoUrl: new URL("https://xapi.tesco.com/"),
  region: Schema.decodeUnknownSync(TescoRegion)("IE"),
  releaseBranch: null,
  suggestionUrl: new URL("https://search.api.tesco.com/search/suggestion/"),
  transactionPurpose: null,
};
const { productId } = Schema.decodeUnknownSync(Model.ProductDetailsInput)({
  productId: "123",
});
const fixture = () => {
  let basket = Schema.decodeUnknownSync(Model.Basket)({
    charges: { depositCharge: 0, minimum: 0, surcharge: 0 },
    guidePrice: 2,
    id: "basket",
    isInAmend: false,
    items: [
      {
        cost: 2,
        id: "line",
        product: {
          id: productId,
          price: { actual: 2, unitOfMeasure: "litre", unitPrice: 2 },
          productType: "SingleProduct",
          title: "Milk",
        },
        quantity: 1,
        substitutionOption: "DoNotSubstitute",
        unit: "pcs",
        weight: 0,
      },
    ],
    localisation: { currency: { iso: "EUR" } },
    orderId: "",
    shoppingMethod: "delivery",
    slot: {
      charge: 3,
      end: "2026-10-20T12:00:00Z",
      expiry: null,
      group: 0,
      id: "slot",
      locationUuid: "location",
      reservationExpiry: "2026-10-20T09:00:00Z",
      start: "2026-10-20T10:00:00Z",
      status: "Reserved",
    },
    totalItems: 1,
    totalPrice: 2,
  });
  if (basket.slot === null) {
    throw new Error("Fixture needs a slot");
  }
  const availableSlot = {
    ...basket.slot,
    id: "public-slot-token",
    status: "Available",
  };
  let review: Option.Option<typeof SavedCheckoutReview.Type> = Option.none();
  const records = new Map<string, typeof ShoppingCommandRecord.Type>();
  let mode:
    | "success"
    | "interrupt"
    | "unauthorized"
    | "innerUnauthorized"
    | "partial" = "success";
  const sent: {
    operationName: string;
    variables: Schema.Json;
    query: string;
  }[] = [];
  let refreshes = 0;
  const readRequests: {
    name: string;
    variables: Readonly<Record<string, Schema.Json>>;
  }[] = [];
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
  const client = HttpClient.make((request) =>
    Effect.suspend(() => {
      if (request.body._tag !== "Uint8Array") {
        return Effect.die("Expected JSON body");
      }
      const input = Schema.decodeUnknownSync(
        Schema.Struct({
          operationName: Schema.String,
          query: Schema.String,
          variables: Schema.Json,
        })
      )(JSON.parse(new TextDecoder().decode(request.body.body)));
      sent.push(input);
      if (mode === "interrupt") {
        return Effect.interrupt;
      }
      if (mode === "unauthorized") {
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(null, { status: 401 })
          )
        );
      }
      if (
        input.operationName === "SetPrivateBasketItems" &&
        mode === "success"
      ) {
        const variables = Schema.decodeUnknownSync(
          Schema.Struct({
            items: Schema.Array(
              Schema.Struct({
                adjustment: Schema.Literal(false),
                id: Schema.String,
                newUnitChoice: Schema.String,
                newValue: Schema.Number,
              })
            ),
          })
        )(input.variables);
        basket = {
          ...basket,
          items: basket.items
            .map((line) => {
              const desired = variables.items.find(
                (item) => item.id === line.product.id
              );
              return desired
                ? {
                    ...line,
                    quantity: desired.newValue,
                    unit: desired.newUnitChoice,
                  }
                : line;
            })
            .filter((line) => line.quantity > 0),
        };
      }
      if (input.operationName === "ReservePrivateSlot") {
        basket = {
          ...basket,
          slot: { ...availableSlot, id: "legacy-id", status: "Reserved" },
        };
      }
      if (input.operationName === "ReleasePrivateSlot") {
        basket = { ...basket, slot: null };
      }
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({
            data: input.operationName.includes("Slot")
              ? {
                  fulfilment: {
                    slot: basket.slot === null ? null : { id: basket.slot.id },
                  },
                }
              : { basket: { id: basket.id } },
            status: mode === "innerUnauthorized" ? 401 : 200,
          })
        )
      );
    })
  );
  const program = makeTescoXapiShopping(config, storage).pipe(
    Effect.provideService(HttpClient.HttpClient, client),
    Effect.provideService(
      TescoAuthSession,
      TescoAuthSession.of({
        authorization: Effect.succeed(
          Redacted.make(
            Schema.decodeUnknownSync(TescoAuthorizationValue)(
              "Bearer test-access"
            )
          )
        ),
        refreshAfterUnauthorized: () => {
          refreshes += 1;
          return Effect.die("Commands must not refresh and replay");
        },
      })
    ),
    Effect.provideService(
      TescoAuthenticatedGraphQlTransport,
      TescoAuthenticatedGraphQlTransport.of({
        execute: (operation) =>
          Effect.sync(() => {
            readRequests.push({
              name: operation.read.operationName,
              variables: operation.variables,
            });
            if (operation.read.operationName === "GetPrivateBasket") {
              return { data: { basket } };
            }
            if (operation.read.operationName === "GetPrivatePreviousOrders") {
              return {
                data: {
                  orderSearch: {
                    info: { count: 0, page: 1, pageSize: 10, total: 0 },
                    orders: [],
                  },
                },
              };
            }
            return { data: { delivery: [availableSlot] } };
          }),
      })
    )
  );
  return {
    basket: () => basket,
    program,
    readRequests,
    records,
    refreshes: () => refreshes,
    sent,
    setBasket: (value: typeof basket) => {
      basket = value;
    },
    setMode: (value: typeof mode) => {
      mode = value;
    },
  };
};
const setInput = (quantity = 2) =>
  Schema.decodeUnknownSync(Model.SetBasketItemsInput)({
    items: [{ productId, quantity, unit: "pcs" }],
    requestId: "basket-request-one",
  });

describe("Tesco shopping state and command safety", () => {
  it.effect(
    "requests past grocery orders explicitly, rather than Tesco's default upcoming orders",
    () =>
      Effect.gen(function* readPastOrders() {
        const test = fixture();
        const service = yield* test.program;
        yield* service.previousOrders(
          Schema.decodeUnknownSync(Model.ListShoppingInput)({ count: 2 })
        );
        expect(test.readRequests).toEqual([
          {
            name: "GetPrivatePreviousOrders",
            variables: {
              contexts: [{ statuses: ["Previous"], type: "GROCERY" }],
              count: 2,
              page: 1,
            },
          },
        ]);
      })
  );
  it.effect(
    "sets absolute quantities once and persists retry identity across service reconstruction",
    () =>
      Effect.gen(function* persistRetryIdentity() {
        const test = fixture();
        const first = yield* test.program;
        expect((yield* first.setBasketItems(setInput())).outcome).toBe(
          "confirmed"
        );
        const restarted = yield* test.program;
        expect((yield* restarted.setBasketItems(setInput())).outcome).toBe(
          "confirmed"
        );
        expect(test.sent).toHaveLength(1);
        expect(test.basket().items[0]?.quantity).toBe(2);
        expect(
          (yield* restarted.setBasketItems(setInput(3)).pipe(Effect.flip))
            .reason
        ).toBe("invalid_input");
        expect(test.sent).toHaveLength(1);
      })
  );
  it.effect("removes with quantity zero, including retry after removal", () =>
    Effect.gen(function* removeAndRetry() {
      const test = fixture();
      const service = yield* test.program;
      const input = setInput(0);
      expect((yield* service.setBasketItems(input)).basket.items).toEqual([]);
      yield* service.setBasketItems(input);
      expect(test.sent).toHaveLength(1);
    })
  );
  it.effect("never refreshes or replays a mutation after 401", () =>
    Effect.gen(function* refuseMutationReplay() {
      const test = fixture();
      test.setMode("unauthorized");
      const service = yield* test.program;
      expect((yield* service.setBasketItems(setInput())).outcome).toBe(
        "uncertain"
      );
      yield* service.setBasketItems(setInput());
      expect(test.sent).toHaveLength(1);
      expect(test.refreshes()).toBe(0);
    })
  );
  it.effect(
    "treats an inner Tesco 401 as failure even when HTTP is 200 and the basket already matches",
    () =>
      Effect.gen(function* rejectInnerUnauthorized() {
        const test = fixture();
        test.setMode("innerUnauthorized");
        const service = yield* test.program;
        expect((yield* service.setBasketItems(setInput(1))).outcome).toBe(
          "uncertain"
        );
        expect(test.sent).toHaveLength(1);
        expect(test.refreshes()).toBe(0);
      })
  );
  it.effect("leaves interrupted attempts non-replayable after a restart", () =>
    Effect.gen(function* retainInterruptedAttempt() {
      const test = fixture();
      test.setMode("interrupt");
      const service = yield* test.program;
      expect(
        (yield* service.setBasketItems(setInput()).pipe(Effect.exit))._tag
      ).toBe("Failure");
      test.setMode("success");
      const restarted = yield* test.program;
      expect((yield* restarted.setBasketItems(setInput())).outcome).toBe(
        "uncertain"
      );
      expect(test.sent).toHaveLength(1);
      expect(test.basket().items[0]?.quantity).toBe(1);
    })
  );
  it.effect(
    "reports unconfirmed partial changes and refuses to repeat them",
    () =>
      Effect.gen(function* reportPartialChange() {
        const test = fixture();
        test.setMode("partial");
        const service = yield* test.program;
        expect((yield* service.setBasketItems(setInput())).outcome).toBe(
          "uncertain"
        );
        yield* service.setBasketItems(setInput());
        expect(test.sent).toHaveLength(1);
      })
  );
  it.effect("rejects editing a basket that amends a placed order", () =>
    Effect.gen(function* protectPlacedOrders() {
      const test = fixture();
      test.setBasket({ ...test.basket(), isInAmend: true });
      const service = yield* test.program;
      expect(
        (yield* service.setBasketItems(setInput()).pipe(Effect.flip)).reason
      ).toBe("invalid_input");
      expect(test.sent).toHaveLength(0);
    })
  );
  it.effect(
    "refuses to release a different reservation and confirms release of the expected one",
    () =>
      Effect.gen(function* releaseExpectedReservation() {
        const test = fixture();
        const service = yield* test.program;
        expect(
          (yield* service
            .releaseSlot({
              expectedSlotId: "different",
              requestId: "slot-release-one",
            })
            .pipe(Effect.flip)).reason
        ).toBe("invalid_input");
        expect(test.sent).toHaveLength(0);
        expect(
          (yield* service.releaseSlot({
            expectedSlotId: "slot",
            requestId: "slot-release-one",
          })).outcome
        ).toBe("confirmed");
        expect(
          (yield* service.releaseSlot({
            expectedSlotId: "slot",
            requestId: "slot-release-one",
          })).outcome
        ).toBe("confirmed");
        expect(test.sent).toHaveLength(1);
      })
  );
  it.effect(
    "confirms a verified delivery window despite Tesco's different basket reservation ID",
    () =>
      Effect.gen(function* reserveVerifiedWindow() {
        const test = fixture();
        const service = yield* test.program;
        const slots = yield* service.deliverySlots({
          end: "2026-10-21",
          start: "2026-10-20",
        });
        const [slot] = slots.slots;
        if (slot === undefined) {
          return yield* Effect.die("Expected availability");
        }
        const input = { requestId: "reserve-slot-test-01", slot };
        const reserved = yield* service.reserveSlot(input);
        expect(reserved.outcome).toBe("confirmed");
        expect(reserved.basket.slot?.id).toBe("legacy-id");
        yield* service.reserveSlot(input);
        expect(test.sent).toHaveLength(1);
        expect(
          (yield* service
            .reserveSlot({
              requestId: "reserve-slot-tampered-01",
              slot: { ...slot, charge: 0 },
            })
            .pipe(Effect.flip)).reason
        ).toBe("invalid_input");
        expect(test.sent).toHaveLength(1);
      })
  );
  it.effect(
    "consumes an unchanged review once without making an order or payment request",
    () =>
      Effect.gen(function* consumeReviewedHandoff() {
        const test = fixture();
        const service = yield* test.program;
        const review = yield* service.prepareCheckout;
        const result = yield* service.checkoutHandoff({ review });
        expect(result.orderPlaced).toBe(false);
        expect(result.checkoutUrl).toContain("www.tesco.ie/checkout/");
        expect(test.sent).toHaveLength(0);
        expect(
          (yield* service.checkoutHandoff({ review }).pipe(Effect.flip)).reason
        ).toBe("invalid_input");
      })
  );
  it.effect(
    "rejects a tampered review even if its fingerprint and ID were copied",
    () =>
      Effect.gen(function* rejectTamperedReview() {
        const test = fixture();
        const service = yield* test.program;
        const review = yield* service.prepareCheckout;
        expect(
          (yield* service
            .checkoutHandoff({
              review: {
                ...review,
                basket: { ...review.basket, guidePrice: 0 },
              },
            })
            .pipe(Effect.flip)).reason
        ).toBe("invalid_input");
        expect(test.sent).toHaveLength(0);
      })
  );
  it.effect("requires new approval after any basket price or slot change", () =>
    Effect.gen(function* rejectChangedBasket() {
      const test = fixture();
      const service = yield* test.program;
      const review = yield* service.prepareCheckout;
      test.setBasket({ ...test.basket(), guidePrice: 3 });
      expect(
        (yield* service.checkoutHandoff({ review }).pipe(Effect.flip)).reason
      ).toBe("invalid_input");
    })
  );
  it.effect("expires reviews after five minutes", () =>
    Effect.gen(function* expireReview() {
      const test = fixture();
      const service = yield* test.program;
      const review = yield* service.prepareCheckout;
      yield* TestClock.adjust("5 minutes");
      expect(
        (yield* service.checkoutHandoff({ review }).pipe(Effect.flip)).reason
      ).toBe("invalid_input");
    })
  );
  it.effect("does not approve a handoff without a reserved slot", () =>
    Effect.gen(function* requireReservation() {
      const test = fixture();
      test.setBasket({ ...test.basket(), slot: null });
      const service = yield* test.program;
      const review = yield* service.prepareCheckout;
      expect(
        (yield* service.checkoutHandoff({ review }).pipe(Effect.flip)).reason
      ).toBe("invalid_input");
    })
  );
  it("bounds quantities, duplicate products, date ranges and strict command fields", () => {
    for (const input of [
      { ...setInput(), approved: true },
      { ...setInput(), items: [{ productId, quantity: -1, unit: "pcs" }] },
      { ...setInput(), items: [...setInput().items, ...setInput().items] },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(Model.SetBasketItemsInput)(input, {
          onExcessProperty: "error",
        })
      ).toThrow();
    }
    expect(() =>
      Schema.decodeUnknownSync(Model.DeliverySlotsInput)({
        end: "2026-11-20",
        start: "2026-10-20",
      })
    ).toThrow();
  });
});
