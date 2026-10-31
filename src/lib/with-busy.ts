import { toast } from "sonner";

/** What a thrown error (a dropped connection mid-way) tells the person */
export const failedMessage = (e: unknown) => "ไม่สำเร็จ ลองอีกครั้ง: " + (e instanceof Error ? e.message : String(e));

/**
 * Run `work` with a busy flag on (a spinning button). The flag always clears, also when
 * `work` throws — then the person is told (the button used to spin forever) and the result
 * is undefined. Errors `work` handles itself keep their own messages.
 */
export async function withBusy<T>(setBusy: (busy: boolean) => void, work: () => Promise<T>, onError: (e: unknown) => void = (e) => toast.error(failedMessage(e))): Promise<T | undefined> {
  setBusy(true);
  try {
    return await work();
  } catch (e) {
    onError(e);
    return undefined;
  } finally {
    setBusy(false);
  }
}
