import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

const STORAGE_KEY = "hobo.clientId.v0";

function randomClientId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function useClientId() {
  const [clientId, setClientId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadClientId() {
      const existing = await AsyncStorage.getItem(STORAGE_KEY);
      if (existing) {
        if (!cancelled) setClientId(existing);
        return;
      }

      const created = randomClientId();
      await AsyncStorage.setItem(STORAGE_KEY, created);
      if (!cancelled) setClientId(created);
    }

    loadClientId().catch((error) => {
      console.warn("Unable to load Hobo client id", error);
      if (!cancelled) setClientId(randomClientId());
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return clientId;
}
