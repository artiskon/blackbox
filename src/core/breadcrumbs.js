export class BreadcrumbManager {
  constructor(maxSize = 80, maxRepeat = 3) {
    this._buffer = [];
    this._maxSize = maxSize;
    this._maxRepeat = maxRepeat;
  }

  add(type, data) {
    const breadcrumb = {
      type,
      timestamp: new Date().toISOString(),
      ...data
    };

    const last = this._buffer[this._buffer.length - 1];

    if (last && last.type === type && this._isSameEvent(type, last, breadcrumb)) {
      const repeatCount = (last.repeatCount || 1);
      if (repeatCount < this._maxRepeat) {
        last.repeatCount = repeatCount + 1;
        last.timestamp = breadcrumb.timestamp;
        return last;
      }
      // After maxRepeat collapses, allow through as new entry
    }

    this._buffer.push(breadcrumb);

    if (this._buffer.length > this._maxSize) {
      this._buffer.shift();
    }

    return breadcrumb;
  }

  _isSameEvent(type, a, b) {
    switch (type) {
      case 'click':
        return a.tag === b.tag && a.id === b.id && a.text === b.text;
      case 'navigation':
        return a.to === b.to;
      case 'network':
        return a.method === b.method && a.url === b.url;
      case 'warning':
      case 'console':
        return a.message === b.message;
      default:
        return a.action === b.action;
    }
  }

  snapshot() {
    return Object.freeze(this._buffer.map(b => ({ ...b })));
  }

  clear() {
    this._buffer = [];
  }

  size() {
    return this._buffer.length;
  }
}
