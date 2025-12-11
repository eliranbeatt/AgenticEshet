# Detailed Implementation Plan: Accounting & Project Costing Module

This plan outlines the implementation of a comprehensive **Project Costing & Breakdown Module** within the existing `studio-console` application (Next.js + Convex). The module mirrors the logic of the provided "Accounting plan" and Excel workflow, ensuring precise tracking of Materials (E), Work (S), Overhead, Risk, and Profit.

## 1. Database Schema Design (Convex)

We will extend the `convex/schema.ts` with the following tables. We adhere to the existing project structure.

### 1.1 Core Accounting Tables

```typescript
// convex/schema.ts updates

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ... existing tables ...

  // 1. Sections (Budget Lines)
  sections: defineTable({
    projectId: v.id("projects"),
    group: v.string(), // e.g., "Studio Elements", "Logistics"
    name: v.string(),
    description: v.optional(v.string()),
    sortOrder: v.number(),
    pricingMode: v.union(v.literal("estimated"), v.literal("actual"), v.literal("mixed")),
    
    // Per-section overrides (optional)
    overheadPercentOverride: v.optional(v.number()),
    riskPercentOverride: v.optional(v.number()),
    profitPercentOverride: v.optional(v.number()),
  })
  .index("by_project", ["projectId"])
  .index("by_project_group", ["projectId", "group"]),

  // 2. Material Lines (The "E" in cost)
  materialLines: defineTable({
    sectionId: v.id("sections"),
    projectId: v.id("projects"), // Denormalized for easier querying
    category: v.string(), // e.g., "PVC", "Paint"
    label: v.string(),
    description: v.optional(v.string()),
    
    // Vendor Link
    vendorId: v.optional(v.id("vendors")),
    vendorName: v.optional(v.string()), // Snapshot or ad-hoc name

    unit: v.string(), // m, sqm, unit
    
    // Planning
    plannedQuantity: v.number(),
    plannedUnitCost: v.number(),
    
    // Actuals
    actualQuantity: v.optional(v.number()),
    actualUnitCost: v.optional(v.number()),
    
    taxRate: v.optional(v.number()), // e.g., 0.17
    status: v.string(), // planned, ordered, received, paid
    note: v.optional(v.string()),
  })
  .index("by_section", ["sectionId"])
  .index("by_project", ["projectId"]),

  // 3. Work Lines (The "S" in cost)
  workLines: defineTable({
    sectionId: v.id("sections"),
    projectId: v.id("projects"),
    workType: v.string(), // studio, field, management
    role: v.string(),
    personId: v.optional(v.string()), // Link to user/employee if needed
    
    rateType: v.string(), // hour, day, flat
    
    // Planning
    plannedQuantity: v.number(),
    plannedUnitCost: v.number(),
    
    // Actuals
    actualQuantity: v.optional(v.number()),
    actualUnitCost: v.optional(v.number()),
    
    status: v.string(), // planned, scheduled, done, paid
    description: v.optional(v.string()),
  })
  .index("by_section", ["sectionId"])
  .index("by_project", ["projectId"]),
  
  // 4. Vendors (Knowledge Base for Agents & Users)
  vendors: defineTable({
    name: v.string(),
    category: v.optional(v.string()),
    contactInfo: v.optional(v.string()),
    rating: v.optional(v.number()),
  }).searchIndex("search_name", { searchField: "name" }),

  // 5. Material Catalog (Historical Data / Price Book)
  materialCatalog: defineTable({
    category: v.string(),
    name: v.string(),
    defaultUnit: v.string(),
    lastPrice: v.number(),
    vendorId: v.optional(v.id("vendors")),
    lastUpdated: v.number(), // Timestamp
  }).searchIndex("search_material", { searchField: "name" }),
});
```

## 2. Backend Logic (Convex Functions)

Calculations are performed strictly in the backend (Python/TypeScript logic equivalent), not LLM-generated, ensuring accuracy.

### 2.1 Core Calculation Logic (`convex/accounting/lib.ts`)
A shared library function that takes a Project and its Sections + Lines and computes the "Snapshot".

```typescript
// Pseudo-code for calculation logic
export function calculateSectionCosts(section, materials, work, projectDefaults) {
   // 1. Effective Percentages
   const overheadPct = section.overheadPercentOverride ?? projectDefaults.overheadPercent;
   const riskPct = section.riskPercentOverride ?? projectDefaults.riskPercent;
   const profitPct = section.profitPercentOverride ?? projectDefaults.profitPercent;

   // 2. Direct Costs (E + S)
   const matCost = materials.reduce((sum, m) => sum + (m.plannedQuantity * m.plannedUnitCost), 0);
   const workCost = work.reduce((sum, w) => sum + (w.plannedQuantity * w.plannedUnitCost), 0);
   const directCost = matCost + workCost;

   // 3. Adders
   const overhead = directCost * overheadPct;
   const risk = directCost * riskPct;
   const profit = directCost * profitPct;
   
   return {
     directCost,
     overhead,
     risk,
     profit,
     clientPrice: directCost + overhead + risk + profit,
     // ... repeat logic for Actuals ...
     gap: plannedTotal - actualTotal
   };
}
```

### 2.2 API Functions (`convex/accounting.ts`)

*   `getProjectAccounting(projectId)`: Fetches project, all sections, materials, and work lines. Returns a structured object with computed totals for the UI to render directly.
*   `updateSection(id, updates)`: Updates section metadata.
*   `updateMaterialLine(id, updates)`: Updates a specific material line. *Triggers re-calculation in UI if using optimistic updates, or backend returns new totals.*
*   `updateWorkLine(id, updates)`: Updates a work line.
*   `saveToCatalog(materialLineId)`: Helper to push a used material/vendor to the `materialCatalog` / `vendors` tables for future agent use.

## 3. Frontend Architecture (Next.js)

We will create a new route: `/projects/[id]/accounting`.
This page will contain a Tabbed Interface (using standard React state or a Tabs component).

### 3.1 Tab 1: Detailed Costs Planning (The "Summary" View)
*   **Visual**: Excel-like grid.
*   **Rows**: Sections (grouped by `group`).
*   **Columns**: 
    *   Section Name (Editable)
    *   Materials (E) - Read-only sum (drill-down available)
    *   Labor (S) - Read-only sum (drill-down available)
    *   Overhead (Calc)
    *   Risk (Calc)
    *   Profit (Calc)
    *   **Client Price** (Total)
*   **Interactions**:
    *   Clicking a row expands it or opens a modal/side-panel to edit the breakdown.
    *   "Add Section" button.

### 3.2 Tab 2: Materials Tracking
*   **Visual**: Detailed Table.
*   **Columns**: Material Name, Vendor (Dropdown/Search), Quantity (Planned vs Actual), Unit Cost (Planned vs Actual), Total Gap.
*   **Features**:
    *   **Vendor Auto-complete**: Queries `vendors` table.
    *   **Save to Catalog**: Button next to rows to save this price/vendor combo for future reference.

### 3.3 Tab 3: Labor Tracking
*   **Visual**: Detailed Table.
*   **Columns**: Task Name, Role, Days/Hours (Est vs Actual), Rate, Total Gap.
*   **Features**:
    *   Breakdown of tasks per section.

## 4. Agent Integration

We will implement a specialized "Estimator Agent".

### 4.1 Agent Workflow
1.  **Trigger**: User clicks "Estimate Section" on a Section row.
2.  **Input**: Section Name (e.g., "Main Stage Construction") + Project Context.
3.  **Process**:
    *   Agent queries `materialCatalog` for historical prices.
    *   Agent generates a list of required materials and labor tasks.
    *   **Constraint**: The Agent *outputs structured JSON* matching the `MaterialLine` and `WorkLine` schema. It does NOT do the math for the final price.
4.  **Output**: The system inserts these lines into the DB. The Backend Calculation Logic (2.1) then computes the totals.

## 5. Implementation Steps

1.  **Schema Migration**: Update `convex/schema.ts` with new tables and run `npx convex dev`.
2.  **Backend Logic**: Create `convex/accounting.ts` with CRUD and Calculation logic.
3.  **UI - Project Page**: Add the "Accounting" tab to the project layout.
4.  **UI - Summary Tab**: Implement the high-level costing grid.
5.  **UI - Details Tabs**: Implement the Materials and Labor editable tables.
6.  **Agent Setup**: Create the `convex/agents/estimator.ts` to handle the JSON generation and catalog lookup.
7.  **Testing**: Verify calculations manually against the Excel sheet logic.
