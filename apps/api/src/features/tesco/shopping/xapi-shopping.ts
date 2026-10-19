import { Clock, Effect, Option, Redacted, Schema } from "effect";
import { HttpBody, HttpClient, HttpClientRequest } from "effect/http";

import { TescoAuthSession } from "../auth/auth-session.port.js";
import { TescoAuthenticatedGraphQlTransport } from "../catalogue/authenticated-graphql-transport.port.js";
import { defineReadOnlyGraphQlOperation } from "../catalogue/graphql-read-operation.js";
import { TescoSessionFailure } from "../mcp/session.model.js";
import type { TescoCatalogueConfig } from "../tesco.config.js";
import * as Model from "./shopping.model.js";

const failure = (reason: TescoSessionFailure["reason"]) =>
  new TescoSessionFailure({ reason });
const slotFields =
  "id start end expiry reservationExpiry charge status group locationUuid";
const priceFields = "actual unitPrice unitOfMeasure";
const promotionFields =
  "id description startDate endDate promotionType price {beforeDiscount afterDiscount}";
const productFields = `id title defaultImageUrl price {${priceFields}} promotions {${promotionFields}}`;
const basketFields = `id orderId guidePrice totalPrice totalItems shoppingMethod isInAmend localisation {currency {iso}} slot {${slotFields}} charges {surcharge minimum depositCharge} items {id quantity cost unit weight substitutionOption product {id title productType price {${priceFields}}}}`;
const orderFields =
  "id orderNo totalPrice totalItems createdDateTime status shoppingMethod slot {id start end charge}";

export const ShoppingCommandRecord = Schema.Struct({
  fingerprint: Schema.String,
  state: Schema.Literals(["started", "confirmed", "uncertain"]),
});
export const SavedCheckoutReview = Schema.Struct({
  expiresAt: Schema.Int,
  fingerprint: Schema.String,
  id: Schema.String,
  used: Schema.Boolean,
});
export interface TescoShoppingStorage<R = never> {
  readonly readCommand: (
    id: string
  ) => Effect.Effect<
    Option.Option<typeof ShoppingCommandRecord.Type>,
    TescoSessionFailure,
    R
  >;
  readonly writeCommand: (
    id: string,
    value: typeof ShoppingCommandRecord.Type
  ) => Effect.Effect<void, TescoSessionFailure, R>;
  readonly readReview: Effect.Effect<
    Option.Option<typeof SavedCheckoutReview.Type>,
    TescoSessionFailure,
    R
  >;
  readonly writeReview: (
    value: typeof SavedCheckoutReview.Type
  ) => Effect.Effect<void, TescoSessionFailure, R>;
}
const digest = (value: string) =>
  Effect.promise(async () => {
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value)
    );
    return Array.from(new Uint8Array(bytes), (v) =>
      v.toString(16).padStart(2, "0")
    ).join("");
  });
const checkoutUrl =
  "https://www.tesco.ie/checkout/en-IE/groceries/recommendations";

/** Owns named Tesco operations. Reads may renew once; commands never replay a vendor request. */
export const makeTescoXapiShopping = <R>(
  config: TescoCatalogueConfig,
  storage: TescoShoppingStorage<R>
) =>
  Effect.gen(function* makeShopping() {
    const reads = yield* TescoAuthenticatedGraphQlTransport;
    const auth = yield* TescoAuthSession;
    const client = yield* HttpClient.HttpClient;
    const read = <S extends Schema.Top>(
      name: string,
      document: string,
      schema: S,
      variables: Readonly<Record<string, Schema.Json>> = {}
    ) =>
      reads
        .execute({
          operation: "shopping",
          read: defineReadOnlyGraphQlOperation({
            document,
            operationName: name,
          }),
          variables,
        })
        .pipe(
          Effect.mapError((cause) =>
            failure(
              cause._tag === "TescoCredentialsRejected"
                ? "authentication"
                : "upstream"
            )
          ),
          Effect.flatMap((json) =>
            Schema.decodeUnknownEffect(Schema.Struct({ data: Schema.Unknown }))(
              json
            ).pipe(
              Effect.flatMap((result) =>
                Schema.decodeUnknownEffect(schema)(result.data)
              ),
              Effect.mapError(() => failure("upstream"))
            )
          )
        );
    const basket = read(
      "GetPrivateBasket",
      `query GetPrivateBasket {basket {${basketFields}}}`,
      Model.BasketResult
    );
    const command = (
      operationName: string,
      query: string,
      variables: Readonly<Record<string, Schema.Json>>
    ) =>
      Effect.gen(function* executeCommandOnce() {
        const authorization = yield* auth.authorization.pipe(
          Effect.mapError(() => failure("authentication"))
        );
        const response = yield* client
          .execute(
            HttpClientRequest.post(config.mangoUrl, {
              body: HttpBody.jsonUnsafe({ operationName, query, variables }),
              headers: {
                accept: "application/json",
                "apollographql-client-name": "meal-planner-api",
                "apollographql-client-version": "0.1.0",
                authorization: Redacted.value(authorization),
                "content-type": "application/json",
                language: config.locale,
                region: config.region,
                "x-apikey": Redacted.value(config.mangoApiKey),
              },
            })
          )
          .pipe(
            Effect.timeout("20 seconds"),
            Effect.mapError(() => failure("upstream"))
          );
        if (response.status !== 200) {
          return yield* failure(
            response.status === 401 ? "authentication" : "upstream"
          );
        }
        const body = yield* response.json.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Struct({
                data: Schema.NullOr(
                  Schema.Struct({
                    basket: Schema.optionalKey(
                      Schema.NullOr(Schema.Struct({ id: Schema.String }))
                    ),
                    fulfilment: Schema.optionalKey(
                      Schema.NullOr(
                        Schema.Struct({
                          slot: Schema.NullOr(
                            Schema.Struct({ id: Schema.String })
                          ),
                        })
                      )
                    ),
                  })
                ),
                errors: Schema.optionalKey(Schema.Array(Schema.Unknown)),
                status: Schema.optionalKey(Schema.Number),
              })
            )
          ),
          Effect.mapError(() => failure("upstream"))
        );
        if (
          body.errors?.length ||
          body.data === null ||
          (body.status !== undefined &&
            (body.status < 200 || body.status >= 300)) ||
          (!body.data.basket && !body.data.fulfilment)
        ) {
          return yield* failure("upstream");
        }
      });
    const runCommand = (
      id: string,
      intent: Schema.Json,
      execute: Effect.Effect<void, TescoSessionFailure>,
      matches: (value: typeof Model.Basket.Type) => boolean,
      allowed: (value: typeof Model.Basket.Type) => boolean = (value) =>
        !value.isInAmend,
      beforeSend: Effect.Effect<void, TescoSessionFailure> = Effect.void
    ) =>
      Effect.gen(function* recordShoppingCommand() {
        const fingerprint = yield* digest(JSON.stringify(intent));
        const previous = yield* storage.readCommand(id);
        if (Option.isSome(previous)) {
          if (previous.value.fingerprint !== fingerprint) {
            return yield* failure("invalid_input");
          }
          const current = yield* basket;
          return {
            basket: current.basket,
            message:
              "Request already attempted; Tesco was not called again. Read this current basket before issuing any new intent.",
            outcome:
              previous.value.state === "confirmed"
                ? ("confirmed" as const)
                : ("uncertain" as const),
          };
        }
        const before = yield* basket;
        if (!allowed(before.basket)) {
          return yield* failure("invalid_input");
        }
        yield* beforeSend;
        // The caller holds the owner's DO semaphore. Persist before I/O; an interruption leaves a non-replayable attempt.
        yield* storage.writeCommand(id, { fingerprint, state: "started" });
        const sent = yield* execute.pipe(Effect.result);
        const current = yield* basket;
        const confirmed = sent._tag === "Success" && matches(current.basket);
        yield* storage.writeCommand(id, {
          fingerprint,
          state: confirmed ? "confirmed" : "uncertain",
        });
        return {
          basket: current.basket,
          message: confirmed
            ? "Tesco confirmed the requested state."
            : "The outcome may be partial or unknown. Inspect the returned basket; this request ID will never be sent again.",
          outcome: confirmed ? ("confirmed" as const) : ("uncertain" as const),
        };
      });
    return {
      basket,
      checkoutHandoff: (input: typeof Model.CheckoutHandoffInput.Type) =>
        Effect.gen(function* checkoutHandoff() {
          const saved = yield* storage.readReview;
          const now = yield* Clock.currentTimeMillis;
          if (
            Option.isNone(saved) ||
            saved.value.used ||
            saved.value.id !== input.review.reviewId ||
            saved.value.fingerprint !== input.review.fingerprint ||
            saved.value.expiresAt !== input.review.expiresAt ||
            saved.value.expiresAt <= now
          ) {
            return yield* failure("invalid_input");
          }
          if (
            (yield* digest(JSON.stringify(input.review.basket))) !==
            saved.value.fingerprint
          ) {
            return yield* failure("invalid_input");
          }
          const current = yield* basket;
          if (
            current.basket.isInAmend ||
            current.basket.items.length === 0 ||
            current.basket.slot === null ||
            !["Reserved", "Booked"].includes(current.basket.slot.status)
          ) {
            return yield* failure("invalid_input");
          }
          const currentFingerprint = yield* digest(
            JSON.stringify(current.basket)
          );
          if (currentFingerprint !== saved.value.fingerprint) {
            return yield* failure("invalid_input");
          }
          yield* storage.writeReview({ ...saved.value, used: true });
          const result: typeof Model.CheckoutHandoffResult.Type = {
            checkoutUrl,
            message:
              "Review approved and checked against the current basket. Open Tesco checkout to complete payment and explicitly confirm the order there. No order has been placed by this tool.",
            orderPlaced: false,
          };
          return result;
        }),
      deliverySlots: (input: typeof Model.DeliverySlotsInput.Type) =>
        read(
          "GetPrivateDeliverySlots",
          `query GetPrivateDeliverySlots($start:String,$end:String){delivery(start:$start,end:$end){${slotFields}}}`,
          Schema.Struct({ delivery: Schema.Array(Model.DeliverySlot) }),
          { end: input.end, start: input.start }
        ).pipe(
          Effect.map(({ delivery }) => ({
            currency: "EUR" as const,
            slots: delivery,
          }))
        ),
      favourites: (input: typeof Model.ListShoppingInput.Type) =>
        read(
          "GetPrivateFavourites",
          `query GetPrivateFavourites($page:Int,$count:Int){favourites(page:$page,count:$count){info{total page count pageSize} products{${productFields}}}}`,
          Schema.Struct({
            favourites: Schema.Struct({
              info: Model.FavouritesResult.fields.pageInformation,
              products: Schema.Array(Model.ShoppingProduct),
            }),
          }),
          { count: input.count, page: input.page }
        ).pipe(
          Effect.map(({ favourites }) => ({
            currency: "EUR" as const,
            pageInformation: favourites.info,
            products: favourites.products,
          }))
        ),
      orderDetails: (input: typeof Model.OrderDetailsInput.Type) =>
        read(
          "GetPrivateOrder",
          `query GetPrivateOrder($id:ID!){order(orderId:$id){${orderFields} items{id quantity unit weight product{id title}}}}`,
          Schema.Struct({ order: Model.OrderDetailsResult.fields.order }),
          { id: input.orderId }
        ).pipe(Effect.map((value) => ({ ...value, currency: "EUR" as const }))),
      prepareCheckout: Effect.gen(function* prepareCheckout() {
        const current = yield* basket;
        const now = yield* Clock.currentTimeMillis;
        const fingerprint = yield* digest(JSON.stringify(current.basket));
        const review = {
          expiresAt: now + 300_000,
          fingerprint,
          id: crypto.randomUUID(),
          used: false,
        };
        yield* storage.writeReview(review);
        const result: typeof Model.CheckoutReview.Type = {
          basket: current.basket,
          checkoutUrl,
          expiresAt: review.expiresAt,
          fingerprint,
          requiresHumanPayment: true,
          reviewId: review.id,
        };
        return result;
      }),
      previousOrders: (input: typeof Model.ListShoppingInput.Type) =>
        read(
          "GetPrivatePreviousOrders",
          `query GetPrivatePreviousOrders($page:Int,$count:Int,$contexts:[OrderContextType]){orderSearch(page:$page,count:$count,orderContexts:$contexts){info{total page count pageSize} orders{${orderFields}}}}`,
          Schema.Struct({
            orderSearch: Schema.Struct({
              info: Model.PreviousOrdersResult.fields.pageInformation,
              orders: Schema.Array(Model.PreviousOrder),
            }),
          }),
          {
            contexts: [{ statuses: ["Previous"], type: "GROCERY" }],
            count: input.count,
            page: input.page,
          }
        ).pipe(
          Effect.map(({ orderSearch }) => ({
            currency: "EUR" as const,
            orders: orderSearch.orders,
            pageInformation: orderSearch.info,
          }))
        ),
      productDetails: (input: typeof Model.ProductDetailsInput.Type) =>
        read(
          "GetPrivateProduct",
          `query GetPrivateProduct($tpnc:String){product(tpnc:$tpnc){${productFields} brandName shortDescription isForSale details {ingredients legalLabelling packSize{value units} allergens{name values} storage preparationAndUsage nutrition {... on NutritionalInfoItemType {name value1 value2 value3 value4}}}}}`,
          Schema.Struct({ product: Schema.NullOr(Model.ProductDetails) }),
          { tpnc: input.productId }
        ).pipe(Effect.map((value) => ({ ...value, currency: "EUR" as const }))),
      releaseSlot: (input: typeof Model.ReleaseSlotInput.Type) =>
        Effect.gen(function* releaseSlot() {
          return yield* runCommand(
            input.requestId,
            { operation: "release_slot", slotId: input.expectedSlotId },
            command(
              "ReleasePrivateSlot",
              "mutation ReleasePrivateSlot{fulfilment(action:UNBOOK){slot{id}}}",
              {}
            ),
            (value) =>
              value.slot === null ||
              ["Cancelled", "Expired"].includes(value.slot.status),
            (value) =>
              !value.isInAmend && value.slot?.id === input.expectedSlotId
          );
        }),
      reserveSlot: (input: typeof Model.ReserveSlotInput.Type) =>
        runCommand(
          input.requestId,
          { operation: "reserve_slot", slot: input.slot },
          command(
            "ReservePrivateSlot",
            "mutation ReservePrivateSlot($id:ID){fulfilment(slotId:$id,action:BOOK){slot{id}}}",
            { id: input.slot.id }
          ),
          (value) =>
            value.slot !== null &&
            ["Reserved", "Booked"].includes(value.slot.status) &&
            Date.parse(value.slot.start) === Date.parse(input.slot.start) &&
            Date.parse(value.slot.end) === Date.parse(input.slot.end) &&
            value.slot.charge === input.slot.charge,
          (value) => !value.isInAmend,
          read(
            "VerifyPrivateDeliverySlot",
            `query VerifyPrivateDeliverySlot($start:String,$end:String){delivery(start:$start,end:$end){${slotFields}}}`,
            Schema.Struct({ delivery: Schema.Array(Model.DeliverySlot) }),
            {
              end: input.slot.end.slice(0, 10),
              start: input.slot.start.slice(0, 10),
            }
          ).pipe(
            Effect.flatMap((value) =>
              value.delivery.some(
                (slot) =>
                  slot.id === input.slot.id &&
                  slot.status === "Available" &&
                  JSON.stringify(slot) === JSON.stringify(input.slot)
              )
                ? Effect.void
                : failure("invalid_input")
            )
          )
        ),
      setBasketItems: (input: typeof Model.SetBasketItemsInput.Type) =>
        Effect.gen(function* setBasketItems() {
          const items = input.items.map((item) => ({
            adjustment: false,
            id: item.productId,
            newUnitChoice: item.unit,
            newValue: item.quantity,
          }));
          return yield* runCommand(
            input.requestId,
            { items, operation: "set_items" },
            command(
              "SetPrivateBasketItems",
              "mutation SetPrivateBasketItems($items:[BasketLineItemInputType]){basket(items:$items){id}}",
              { items }
            ),
            (value) =>
              input.items.every((item) => {
                const actual = value.items.find(
                  (line) => line.product.id === item.productId
                );
                return item.quantity === 0
                  ? actual === undefined || actual.quantity === 0
                  : actual?.quantity === item.quantity &&
                      actual.unit === item.unit;
              })
          );
        }),
    };
  });
