export function installNavigationHook(blackbox) {
  let previousPath = blackbox._getCurrentPath();

  const recordNavigation = () => {
    try {
      const newPath = blackbox._getCurrentPath();
      if (newPath !== previousPath) {
        blackbox._addBreadcrumb('navigation', { from: previousPath, to: newPath });
        previousPath = newPath;
      }
    } catch { /* BlackBox must never crash the host app */ }
  };

  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    const result = originalPushState(...args);
    recordNavigation();
    return result;
  };

  history.replaceState = function (...args) {
    const result = originalReplaceState(...args);
    recordNavigation();
    return result;
  };

  const popstateHandler = () => {
    recordNavigation();
  };

  window.addEventListener('popstate', popstateHandler);

  return () => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.removeEventListener('popstate', popstateHandler);
  };
}
