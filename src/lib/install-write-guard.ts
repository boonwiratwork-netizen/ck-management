// Imported first in main.tsx: the Supabase client keeps the fetch it finds at
// creation, so the write guard has to be in place before anything imports it.
import { installWriteGuard } from "./base-cache";

installWriteGuard();
