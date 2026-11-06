import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by SD (implementation_plan.md §3.10). */
export const sdEvents: EventCatalog = {
  VehicleHandedOver: {
    module: "sd",
    labelKey: "sd.events.VehicleHandedOver",
    consumers: ["consumers.sales", "consumers.inventory", "consumers.gl", "consumers.sms"],
    severity: "success",
  },
  GoodsDelivered: {
    module: "sd",
    labelKey: "sd.events.GoodsDelivered",
    consumers: ["consumers.sales", "consumers.inventory", "consumers.gl", "consumers.sms"],
    severity: "success",
  },
}
