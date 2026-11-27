// jobs/dispatchWaves.js
// Every 10 seconds: start dispatch for deliveries that have just been paid,
// offer unaccepted deliveries and rides to the next wave of riders, and
// cancel rides nobody accepted in time.
// See services/dispatch/dispatch.service.js.
import cron from "node-cron";
import { processDispatchQueue } from "../services/dispatch/dispatch.service.js";

let running = false;

const startDispatchWavesJob = (getIo) => {
  cron.schedule("*/10 * * * * *", async () => {
    if (running) return; // don't overlap slow ticks
    running = true;
    try {
      const { started, waves, expiredRides } = await processDispatchQueue(getIo?.());
      if (started || waves || expiredRides) {
        console.log(` Dispatch: started ${started}, advanced ${waves} wave(s), expired ${expiredRides} ride(s)`);
      }
    } catch (error) {
      console.error(" Dispatch job error:", error.message);
    } finally {
      running = false;
    }
  });
};

export default startDispatchWavesJob;
