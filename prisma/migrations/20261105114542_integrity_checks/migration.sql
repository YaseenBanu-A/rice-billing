-- Integrity rules enforced by PostgreSQL itself, in addition to the API's validation.

-- a single company settings row
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_single_row" CHECK (id = 1);

-- a payment belongs to exactly one bill or one purchase
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_one_parent" CHECK ((("invoiceId" IS NOT NULL)::int + ("purchaseId" IS NOT NULL)::int) = 1);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_sign" CHECK ((kind = 'PAYMENT' AND amount > 0) OR (kind = 'REFUND' AND amount < 0));

ALTER TABLE "Product" ADD CONSTRAINT "Product_amounts" CHECK (price >= 0 AND "purchasePrice" >= 0 AND "gstRate" >= 0 AND "gstRate" <= 100 AND "reorderLevel" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_bag_weight" CHECK ("bagWeight" IS NULL OR "bagWeight" > 0);

ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_amounts" CHECK (quantity > 0 AND price >= 0 AND "gstRate" >= 0 AND (bags IS NULL OR bags >= 0));
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_amounts" CHECK (quantity > 0 AND price >= 0 AND "gstRate" >= 0 AND (bags IS NULL OR bags >= 0));
ALTER TABLE "SalesReturnItem" ADD CONSTRAINT "SalesReturnItem_amounts" CHECK (quantity > 0 AND amount >= 0);

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_amounts" CHECK ("grandTotal" >= 0 AND balance >= 0 AND "returnTotal" >= 0 AND "changeReturned" >= 0 AND "discountValue" >= 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_discount_type" CHECK ("discountType" IN ('amount', 'percent'));
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_status" CHECK (status IN ('Paid', 'Partial', 'Unpaid', 'Cancelled'));
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_amounts" CHECK ("grandTotal" >= 0 AND balance >= 0 AND "discountValue" >= 0);
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_status" CHECK (status IN ('Paid', 'Partial', 'Unpaid', 'Cancelled'));
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount" CHECK (amount > 0);
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_range" CHECK (rate >= 0 AND rate <= 100);

-- fast case-insensitive search on names
CREATE INDEX "Customer_name_lower_idx" ON "Customer" (lower(name));
CREATE INDEX "Product_name_lower_idx" ON "Product" (lower(name));
