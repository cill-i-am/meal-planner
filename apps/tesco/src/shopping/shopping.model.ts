import { Effect, Schema } from "effect";

import {
  ProductId,
  ResultCount,
  PageNumber,
  ProductPrice,
  ProductPromotion,
} from "../catalogue/catalogue.model.js";

const Text = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512)
);
const Amount = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
);
const nullableText = Schema.NullOr(Schema.String);
export const Promotion = ProductPromotion;
export const ShoppingProduct = Schema.Struct({
  defaultImageUrl: nullableText,
  id: ProductId,
  price: Schema.NullOr(ProductPrice),
  promotions: Schema.Array(Promotion),
  title: Text,
});
export const ProductDetails = Schema.Struct({
  ...ShoppingProduct.fields,
  brandName: nullableText,
  details: Schema.NullOr(
    Schema.Struct({
      allergens: Schema.NullOr(
        Schema.Array(
          Schema.Struct({
            name: nullableText,
            values: Schema.NullOr(Schema.Array(Schema.String)),
          })
        )
      ),
      ingredients: Schema.NullOr(Schema.Array(Schema.String)),
      legalLabelling: Schema.NullOr(Schema.Array(Schema.String)),
      nutrition: Schema.NullOr(
        Schema.Array(
          Schema.Struct({
            name: Schema.optionalKey(nullableText),
            value1: Schema.optionalKey(nullableText),
            value2: Schema.optionalKey(nullableText),
            value3: Schema.optionalKey(nullableText),
            value4: Schema.optionalKey(nullableText),
          })
        )
      ),
      packSize: Schema.NullOr(
        Schema.Array(
          Schema.Struct({ units: nullableText, value: nullableText })
        )
      ),
      preparationAndUsage: Schema.NullOr(Schema.Array(Schema.String)),
      storage: Schema.NullOr(Schema.Array(Schema.String)),
    })
  ),
  isForSale: Schema.NullOr(Schema.Boolean),
  shortDescription: nullableText,
});
export const ProductDetailsResult = Schema.Struct({
  currency: Schema.Literal("EUR"),
  product: Schema.NullOr(ProductDetails),
});
export const ProductDetailsInput = Schema.Struct({ productId: ProductId });
const PageInfo = Schema.Struct({
  count: Schema.Int,
  page: Schema.Int,
  pageSize: Schema.Int,
  total: Schema.Int,
});
export const FavouritesResult = Schema.Struct({
  currency: Schema.Literal("EUR"),
  pageInformation: PageInfo,
  products: Schema.Array(ShoppingProduct),
});
export const ListShoppingInput = Schema.Struct({
  count: ResultCount.check(Schema.isLessThanOrEqualTo(24)).pipe(
    Schema.withDecodingDefaultTypeKey(
      Effect.succeed(Schema.decodeUnknownSync(ResultCount)(10))
    )
  ),
  page: PageNumber.pipe(
    Schema.withDecodingDefaultTypeKey(
      Effect.succeed(Schema.decodeUnknownSync(PageNumber)(1))
    )
  ),
});
export const DeliverySlot = Schema.Struct({
  charge: Schema.NullOr(Amount),
  end: Text,
  expiry: nullableText,
  group: Schema.NullOr(Schema.Int),
  id: Text,
  locationUuid: nullableText,
  reservationExpiry: nullableText,
  start: Text,
  status: Text,
});
export const BasketLine = Schema.Struct({
  cost: Amount,
  id: Text,
  product: Schema.Struct({
    id: ProductId,
    price: Schema.NullOr(ProductPrice),
    productType: nullableText,
    title: Text,
  }),
  quantity: Amount,
  substitutionOption: nullableText,
  unit: Text,
  weight: Schema.NullOr(Amount),
});
export const Basket = Schema.Struct({
  charges: Schema.Struct({
    depositCharge: Schema.NullOr(Amount),
    minimum: Schema.NullOr(Amount),
    surcharge: Schema.NullOr(Amount),
  }),
  guidePrice: Amount,
  id: Text,
  isInAmend: Schema.Boolean,
  items: Schema.Array(BasketLine),
  localisation: Schema.Struct({
    currency: Schema.Struct({ iso: Schema.Literal("EUR") }),
  }),
  orderId: nullableText,
  shoppingMethod: nullableText,
  slot: Schema.NullOr(DeliverySlot),
  totalItems: Schema.Int,
  totalPrice: Amount,
});
export const BasketResult = Schema.Struct({ basket: Basket });
const DateString = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)
);
export const DeliverySlotsInput = Schema.Struct({
  end: DateString,
  start: DateString,
}).check(
  Schema.makeFilter((value) => {
    const duration = Date.parse(value.end) - Date.parse(value.start);
    return (
      Number.isFinite(duration) && duration >= 0 && duration <= 7 * 86_400_000
    );
  })
);
export const DeliverySlotsResult = Schema.Struct({
  currency: Schema.Literal("EUR"),
  slots: Schema.Array(DeliverySlot),
});
export const PreviousOrder = Schema.Struct({
  createdDateTime: nullableText,
  id: Text,
  orderNo: nullableText,
  shoppingMethod: nullableText,
  slot: Schema.NullOr(
    Schema.Struct({
      charge: Schema.NullOr(Amount),
      end: nullableText,
      id: nullableText,
      start: nullableText,
    })
  ),
  status: nullableText,
  totalItems: Schema.NullOr(Schema.Int),
  totalPrice: Schema.NullOr(Amount),
});
export const PreviousOrdersResult = Schema.Struct({
  currency: Schema.Literal("EUR"),
  orders: Schema.Array(PreviousOrder),
  pageInformation: PageInfo,
});
export const OrderDetailsInput = Schema.Struct({ orderId: Text });
export const OrderDetailsResult = Schema.Struct({
  currency: Schema.Literal("EUR"),
  order: Schema.NullOr(
    Schema.Struct({
      ...PreviousOrder.fields,
      items: Schema.Array(
        Schema.Struct({
          id: Text,
          product: Schema.Struct({ id: ProductId, title: Text }),
          quantity: Amount,
          unit: Text,
          weight: Schema.NullOr(Amount),
        })
      ),
    })
  ),
});
export const SetBasketItemsInput = Schema.Struct({
  items: Schema.NonEmptyArray(
    Schema.Struct({
      productId: ProductId,
      quantity: Amount.check(Schema.isLessThanOrEqualTo(99)),
      unit: Schema.Literals(["pcs", "kg"]),
    })
  ).check(Schema.isMaxLength(48)),
  requestId: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{16,80}$/u)),
}).check(
  Schema.makeFilter(
    (value) =>
      new Set(value.items.map((item) => item.productId)).size ===
      value.items.length
  )
);
export const ReserveSlotInput = Schema.Struct({
  requestId: SetBasketItemsInput.fields.requestId,
  slot: DeliverySlot,
});
export const ReleaseSlotInput = Schema.Struct({
  expectedSlotId: Text,
  requestId: SetBasketItemsInput.fields.requestId,
});
export const BasketCommandResult = Schema.Struct({
  basket: Basket,
  message: Schema.String,
  outcome: Schema.Literals(["confirmed", "rejected", "uncertain"]),
});
export const CheckoutReview = Schema.Struct({
  basket: Basket,
  checkoutUrl: Schema.Literal(
    "https://www.tesco.ie/checkout/en-IE/groceries/recommendations"
  ),
  expiresAt: Schema.Int,
  fingerprint: Schema.String,
  requiresHumanPayment: Schema.Literal(true),
  reviewId: Text,
});
export const CheckoutHandoffInput = Schema.Struct({ review: CheckoutReview });
export const CheckoutHandoffResult = Schema.Struct({
  checkoutUrl: CheckoutReview.fields.checkoutUrl,
  message: Schema.String,
  orderPlaced: Schema.Literal(false),
});
export const EmptyInput = Schema.Struct({});
