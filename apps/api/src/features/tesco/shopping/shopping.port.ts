import { Context } from "effect";
import type { Schema, Effect } from "effect";

import type { TescoSessionFailure } from "../mcp/session.model.js";
import type * as Model from "./shopping.model.js";

type Operation<I extends Schema.Top, O extends Schema.Top> = (
  input: I["Type"]
) => Effect.Effect<O["Type"], TescoSessionFailure>;
export interface TescoShopping {
  readonly productDetails: Operation<
    typeof Model.ProductDetailsInput,
    typeof Model.ProductDetailsResult
  >;
  readonly favourites: Operation<
    typeof Model.ListShoppingInput,
    typeof Model.FavouritesResult
  >;
  readonly previousOrders: Operation<
    typeof Model.ListShoppingInput,
    typeof Model.PreviousOrdersResult
  >;
  readonly orderDetails: Operation<
    typeof Model.OrderDetailsInput,
    typeof Model.OrderDetailsResult
  >;
  readonly basket: Effect.Effect<
    typeof Model.BasketResult.Type,
    TescoSessionFailure
  >;
  readonly deliverySlots: Operation<
    typeof Model.DeliverySlotsInput,
    typeof Model.DeliverySlotsResult
  >;
  readonly setBasketItems: Operation<
    typeof Model.SetBasketItemsInput,
    typeof Model.BasketCommandResult
  >;
  readonly reserveSlot: Operation<
    typeof Model.ReserveSlotInput,
    typeof Model.BasketCommandResult
  >;
  readonly releaseSlot: Operation<
    typeof Model.ReleaseSlotInput,
    typeof Model.BasketCommandResult
  >;
  readonly prepareCheckout: Effect.Effect<
    typeof Model.CheckoutReview.Type,
    TescoSessionFailure
  >;
  readonly checkoutHandoff: Operation<
    typeof Model.CheckoutHandoffInput,
    typeof Model.CheckoutHandoffResult
  >;
}
export const TescoShopping = Context.Service<TescoShopping>(
  "meal-planner/tesco/Shopping"
);
