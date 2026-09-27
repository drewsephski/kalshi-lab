import assert from "node:assert/strict";
import test from "node:test";
import { runSmokeOrder } from "./smoke-order.ts";

for (const failure of ["cancel", "retrieve", "none"] as const) {
  test(`smoke cleanup retries a failed cancellation only (${failure})`, async () => {
    let creates = 0;
    let cancels = 0;
    const client = {
      getMarkets: async () => [
        { ticker: "TEST", title: "Test", status: "active" },
      ],
      createOrder: async () => {
        creates++;
        return {
          orderId: "only-order",
          clientOrderId: "test",
          remainingCount: "1.00",
          filledCount: "0.00",
        };
      },
      getOrder: async () => {
        if (failure === "retrieve") throw new Error("retrieval failed");
        return {
          orderId: "only-order",
          clientOrderId: "test",
          ticker: "TEST",
          status: cancels ? "canceled" : "resting",
          remainingCount: "0.00",
          filledCount: "0.00",
        };
      },
      cancelOrder: async (id: string, ticker: string) => {
        assert.equal(id, "only-order");
        assert.equal(ticker, "TEST");
        cancels++;
        if (failure === "cancel" && cancels === 1)
          throw new Error("cancellation failed");
      },
    };
    if (failure === "none") await runSmokeOrder(client);
    else await assert.rejects(runSmokeOrder(client), /failed/);
    assert.equal(creates, 1);
    assert.equal(cancels, failure === "cancel" ? 2 : 1);
  });
}

test("successful cancellation is not retried when final retrieval fails", async () => {
  let cancels = 0;
  let gets = 0;
  await assert.rejects(
    runSmokeOrder({
      getMarkets: async () => [
        { ticker: "TEST", title: "Test", status: "active" },
      ],
      createOrder: async () => ({
        orderId: "only-order",
        clientOrderId: "test",
        remainingCount: "1.00",
        filledCount: "0.00",
      }),
      getOrder: async () => {
        if (++gets === 2) throw new Error("final retrieval failed");
        return {
          orderId: "only-order",
          clientOrderId: "test",
          ticker: "TEST",
          status: "resting",
          remainingCount: "1.00",
          filledCount: "0.00",
        };
      },
      cancelOrder: async () => {
        cancels++;
      },
    }),
    /final retrieval failed/,
  );
  assert.equal(cancels, 1);
});
