import { db } from "@/db/client";
import { systemSettings } from "@/db/schema";
import { Truck } from "lucide-react";
import {
  PageHeader,
  Card,
  CardHeader,
  Badge,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

export default async function ShippingSettingsPage() {
  const settings = await db.select().from(systemSettings);
  const map = new Map(settings.map((s) => [s.key, s.value]));

  const flatRate = String(map.get("shipping.flat_rate_paise") ?? "0");
  const freeAbove = String(map.get("shipping.free_above_paise") ?? "0");
  const couriers = String(map.get("shipping.couriers") ?? "delhivery,bluedart,dtdc,indiapost,professional");

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Shipping"
        eyebrow="System Configuration"
      />

      <Card className="mb-4">
        <CardHeader title="Fees" />
        <Row label="Flat shipping fee" value={`₹${(Number(flatRate) / 100).toFixed(2)}`} />
        <Row label="Free shipping above" value={`₹${(Number(freeAbove) / 100).toFixed(2)}`} />
      </Card>

      <Card>
        <CardHeader
          title="Carriers"
        />
        <div className="flex flex-wrap gap-2">
          {couriers.split(",").map((c) => (
            <Badge key={c} tone="subtle" size="md">
              <Truck className="h-3 w-3 mr-1" />
              {c.trim()}
            </Badge>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-ink-100/70 last:border-0">
      <span className="text-[13px] text-ink-700">{label}</span>
      <span className="text-[13px] font-mono tabular-nums">{value}</span>
    </div>
  );
}
