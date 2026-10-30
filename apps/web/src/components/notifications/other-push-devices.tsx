import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

// The member's OTHER browsers that still receive their push (SEC-54), each with a Remove that stops
// push there from here: for a shared or lost device, or one they no longer sign in on. This browser
// is left out (its own on/off control sits above), which is why the list waits until the browser's
// subscription has been read (`ready`) and passes its endpoint so the server can flag it. The server
// never returns endpoints or keys, only the push service and when the device was added.
export function OtherPushDevices({
  currentEndpoint,
  ready,
}: {
  currentEndpoint: string | null | undefined;
  ready: boolean;
}) {
  const t = useTranslations("notifications");
  const format = useFormatter();
  const { data: devices } = useQuery(
    convexQuery(
      gateway.notifications.pushDevices,
      ready ? { currentEndpoint: currentEndpoint ?? undefined } : "skip",
    ),
  );
  const revoke = useMutation({
    mutationFn: useConvexMutation(gateway.notifications.revokePushDevice),
    onSuccess: () => toast.success(t("pushDeviceRemoved")),
    onError: (error) => {
      console.error("[push] revoke device failed:", error);
      toast.error(t("pushDeviceRemoveError"));
    },
  });

  const others = devices?.filter((device) => !device.current) ?? [];
  if (others.length === 0) return null;

  return (
    <div className="mt-4">
      <h3 className="text-sm font-medium">{t("pushOtherDevicesTitle")}</h3>
      <p className="text-muted-foreground mt-1 text-xs">
        {t("pushOtherDevicesHint")}
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {others.map((device) => {
          const name = t(`pushServices.${device.service}`);
          const date = format.dateTime(device.createdAt, {
            dateStyle: "medium",
          });
          return (
            <li
              key={device.id}
              className="bg-muted/30 flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-sm">{name}</span>
                <span className="text-muted-foreground text-xs">
                  {t("pushDeviceAdded", { date })}
                </span>
              </span>
              <Button
                variant="outline"
                size="sm"
                aria-label={t("pushDeviceRemoveLabel", { device: name, date })}
                disabled={revoke.isPending}
                onClick={() => revoke.mutate({ id: device.id })}
              >
                {t("pushDeviceRemove")}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
