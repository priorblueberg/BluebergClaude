import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { Loader2 } from "lucide-react";

export function RecalculatingOverlay() {
  const { isRecalculating } = useDataReferencia();

  if (!isRecalculating) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm rounded-md">
      <div className="flex flex-col items-center gap-2">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Recalculando...</p>
      </div>
    </div>
  );
}
