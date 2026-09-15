export function installNavigationHook(blackbox) {
  let previousPath = blackbox._getCurrentPath();
  // Cleared on teardown: if a later wrapper sits on top of ours, we can't
  // unwind without dropping it, so our patch becomes a pass-through instead
  let active = true;

  const recordNavigation = () => {
    if (!active) return;
    try {
      const newPath = blackbox._getCurrentPath();
      if (newPath !== previousPath) {
        blackbox._addBreadcrumb('navigation', { from: previousPath, to: newPath });
        previousPath = newPath;
      }
    } catch { /* BlackBox must never crash the host app */ }
  };

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  const patchedPushState = function (...args) {
    const result = originalPushState.apply(history, args);
    recordNavigation();
    return result;
  };

  const patchedReplaceState = function (...args) {
    const result = originalReplaceState.apply(history, args);
    recordNavigation();
    return result;
  };

  history.pushState = patchedPushState;
  history.replaceState = patchedReplaceState;

  const popstateHandler = () => {
    recordNavigation();
  };

  window.addEventListener('popstate', popstateHandler);

  return () => {
    active = false;
    if (history.pushState === patchedPushState) history.pushState = originalPushState;
    if (history.replaceState === patchedReplaceState) history.replaceState = originalReplaceState;
    window.removeEventListener('popstate', popstateHandler);
  };
}
