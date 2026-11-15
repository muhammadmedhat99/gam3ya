"use client";

import { Button } from "@heroui/react";

export function RetryButton() {
  return (
    <Button size="lg" fullWidth onPress={() => window.location.reload()}>
      جرب تاني
    </Button>
  );
}
