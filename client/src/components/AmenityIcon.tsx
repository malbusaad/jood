import {
  Armchair,
  Bath,
  Coffee,
  CookingPot,
  Sofa,
  Tent,
  ToyBrick,
  UtensilsCrossed,
  Volleyball,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import type { AmenityIconName } from "../content/types";

const icons: Record<AmenityIconName, LucideIcon> = {
  tent: Tent,
  majlis: Sofa,
  dining: UtensilsCrossed,
  outdoor: Armchair,
  kitchen: CookingPot,
  restroom: Bath,
  volleyball: Volleyball,
  coffee: Coffee,
  kids: ToyBrick,
  wifi: Wifi,
};

export default function AmenityIcon({ name, className = "" }: { name: AmenityIconName; className?: string }) {
  const Icon = icons[name];
  return <Icon aria-hidden className={className} strokeWidth={1.25} />;
}
