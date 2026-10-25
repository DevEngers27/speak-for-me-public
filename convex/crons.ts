import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();
crons.hourly("roll room local dates", { minuteUTC: 1 }, internal.clock.rollLocalDate, {});
crons.hourly("expire human requests", { minuteUTC: 20 }, internal.humanRequests.expireDue, {});
crons.interval("liveness sweep", { minutes: 5 }, internal.ops.livenessSweep, {});
crons.daily("purge raw model outputs", { hourUTC: 3, minuteUTC: 10 }, internal.ops.purgeRawOutputs, {});

export default crons;
