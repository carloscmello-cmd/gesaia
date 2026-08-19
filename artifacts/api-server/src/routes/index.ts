import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import companiesRouter from "./companies";
import calculationsRouter from "./calculations";
import investigationsRouter from "./investigations";
import simulationsRouter from "./simulations";
import networksRouter from "./networks";
import dashboardRouter from "./dashboard";
import reportsRouter from "./reports";
import fullReportRouter from "./fullReport";
import anthropicRouter from "./anthropic";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/users", usersRouter);
router.use("/companies", companiesRouter);
router.use("/companies", calculationsRouter);
router.use("/companies", investigationsRouter);
router.use("/companies", fullReportRouter);
router.use("/companies", simulationsRouter);
router.use("/simulations", simulationsRouter); // expõe /api/simulations/run
router.use("/networks", networksRouter);
router.use("/dashboard", dashboardRouter);
router.use("/reports", reportsRouter);
router.use("/anthropic", anthropicRouter);

export default router;
