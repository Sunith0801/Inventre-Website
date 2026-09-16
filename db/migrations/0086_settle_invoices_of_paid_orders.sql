-- Invoices are generated right after CCAvenue confirms payment, but until
-- now they were inserted with outstanding_amount = grand_total and status
-- 'submitted', and nothing ever cleared them (only a manual payment entry
-- does). Every online sale therefore showed as fully overdue in Receivables.
--
-- Settle every non-return invoice whose order is paid and which has no
-- manual payment entry recorded against it (those were reconciled by hand
-- and already carry the right balance).
UPDATE invoices i
   SET outstanding_amount = 0,
       status = 'paid',
       updated_at = now()
  FROM orders o
 WHERE o.id = i.order_id
   AND o.payment_status = 'paid'
   AND i.is_return = false
   AND i.status <> 'cancelled'
   AND i.outstanding_amount > 0
   AND NOT EXISTS (
         SELECT 1 FROM payment_entries pe
          WHERE pe.invoice_id = i.id AND pe.direction = 'received'
       );
