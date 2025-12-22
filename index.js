// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { uploadsDir } from "./upload.js";

// --- IMPORT LIMITER DARI FILE BARU ---
import { globalLimiter } from "./middleware/limiter.js";

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
import importRoutes from "./routes/importRoutes.js";
import opnameRoutes from "./routes/opnameRoutes.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

// 1. SECURITY HEADERS
app.use(helmet());

// 2. CORS CONFIG
app.use(cors({
  origin: "http://localhost:5173", 
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// 3. PARSE COOKIES & JSON
app.use(cookieParser());
app.use(express.json());

// 4. GLOBAL RATE LIMITER
// (Definisi manual dihapus, langsung pakai yang di-import)
app.use(globalLimiter);

// static uploads
app.use("/uploads", express.static(uploadsDir, {
  setHeaders: (res) => {
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
  }
}));



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
app.use("/api/import", importRoutes);
app.use("/api/opname", opnameRoutes);

// listen
app.listen(port, () => {
  console.log(`API server running on port ${port}`);
});