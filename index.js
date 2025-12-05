// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { uploadsDir } from "./upload.js";

// routers
import healthRouter from "./routes/healthRoutes.js";
import assetRouter from "./routes/assetRoutes.js";
import loanRouter from "./routes/loanRoutes.js";
import fundingSourceRouter from "./routes/fundingSourceRoutes.js";
import locationRouter from "./routes/locationRoutes.js";
import categoryRouter from "./routes/categoryRoutes.js";
import roleRouter from "./routes/roleRoutes.js";
import userRouter from "./routes/userRoutes.js";
import budgetCodeRouter from "./routes/budgetCodeRoutes.js";
import authRouter from "./routes/authRoutes.js";
import entityRouter from "./routes/entityRoutes.js";
import permissionRouter from "./routes/permissionRoutes.js";



dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// static uploads
app.use("/uploads", express.static(uploadsDir));

// routes
app.use("/api/health", healthRouter);
app.use("/api/assets", assetRouter);
app.use("/api/loans", loanRouter);
app.use("/api/funding-sources", fundingSourceRouter);
app.use("/api/locations", locationRouter);
app.use("/api/categories", categoryRouter);
app.use("/api/roles", roleRouter);
app.use("/api/users", userRouter);
app.use("/api/budget-codes", budgetCodeRouter);
app.use("/api", authRouter);       
app.use("/api/entities", entityRouter);
app.use("/api/permissions", permissionRouter);

// listen
app.listen(port, () => {
  console.log(`API server running on port ${port}`);
});
