export function installFormHook(blackbox) {
  // Shared by both listeners. `blocked` = the browser's native constraint
  // validation stopped the submission, so no `submit` event ever fired.
  const report = (form, blocked) => {
    try {
      if (!form || form.tagName?.toLowerCase() !== 'form') return;

      const fields = form.elements ? Array.from(form.elements) : [];
      const invalidFields = [];

      for (const field of fields) {
        if (field.name && field.validity && !field.validity.valid) {
          invalidFields.push({
            name: field.name,
            validationMessage: field.validationMessage || ''
          });
        }
      }

      const crumb = {
        action: 'form_submit',
        // Attributes, not `form.id` / `form.name`: a control named "id" or
        // "name" shadows those properties and would put a DOM node here,
        // which Firestore rejects on every later write.
        formId: form.getAttribute('id') || form.getAttribute('name') || 'unknown_form',
        fieldCount: fields.filter(f => f.name).length,
        invalidCount: invalidFields.length,
        invalidFields,
        ...(blocked ? { blocked: true } : {})
      };

      blackbox._addBreadcrumb('form', crumb);

      if (invalidFields.length > 0) {
        blackbox._recordError({
          message: `Form validation failed: ${crumb.formId} (${invalidFields.length} invalid fields)`,
          stack: '',
          source: 'form_validation',
          context: { formId: crumb.formId, invalidFields }
        });
      }
    } catch { /* BlackBox must never crash the host app */ }
  };

  const onSubmit = (event) => report(event.target, false);

  // `invalid` also fires for checkValidity()/reportValidity() calls, which
  // apps run on render or change. So only count it while a user submit
  // attempt is in progress: a click on a submit control, or Enter in a field
  // (implicit submission runs on keypress in Blink/Gecko/WebKit, so both key
  // events mark). Validation runs synchronously in that same event's task;
  // the mark clears on the next task. Programmatic requestSubmit() is not
  // tracked.
  const attempted = new Set();
  const markAttempt = (form) => {
    if (!form || attempted.has(form)) return;
    attempted.add(form);
    setTimeout(() => attempted.delete(form), 0);
  };
  const onClick = (event) => {
    try {
      const el = event.target?.closest?.('button, input');
      if (el && (el.type === 'submit' || el.type === 'image')) markAttempt(el.form);
    } catch { /* BlackBox must never crash the host app */ }
  };
  const onKey = (event) => {
    try {
      if (event.key === 'Enter' && event.target?.tagName !== 'TEXTAREA') markAttempt(event.target?.form);
    } catch { /* BlackBox must never crash the host app */ }
  };

  // `invalid` fires once per bad control and doesn't bubble (capture works).
  // Batch per form with setTimeout, not a microtask: microtasks run between
  // the browser's per-control dispatches, so they'd fire after the first one.
  const pending = new Set();
  const onInvalid = (event) => {
    try {
      const form = event.target?.form;
      if (!form || !attempted.has(form) || pending.has(form)) return;
      pending.add(form);
      setTimeout(() => { pending.delete(form); report(form, true); }, 0);
    } catch { /* BlackBox must never crash the host app */ }
  };

  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('invalid', onInvalid, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keypress', onKey, true);

  return () => {
    document.removeEventListener('submit', onSubmit, true);
    document.removeEventListener('invalid', onInvalid, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keypress', onKey, true);
  };
}
