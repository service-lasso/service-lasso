export function createPairCheckpoint(channel) {
  let released = false;
  let resolveWait;
  const onMessage = message => {
    if (message?.stage === "allow-cleanup") { released = true; resolveWait?.(); }
  };
  const onDisconnect = () => { released = true; resolveWait?.(); };
  channel.on("message", onMessage);
  channel.on("disconnect", onDisconnect);
  return {
    async wait(identity) {
      if (released || !channel.connected) throw new Error("Pair coordinator unavailable or aborted.");
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Pair cleanup checkpoint timeout")), 35 * 60_000);
        resolveWait = () => { clearTimeout(timer); resolve(); };
        channel.send({ stage: "browser-complete", identity });
      });
    },
    dispose() { channel.off("message", onMessage); channel.off("disconnect", onDisconnect); },
  };
}
