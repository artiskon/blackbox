export function installFormHook(blackbox) {
  const handler = (event) => {
    try {
      const form = event.target;
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
        formId: form.id || form.name || 'unknown_form',
        fieldCount: fields.filter(f => f.name).length,
        invalidCount: invalidFields.length,
        invalidFields
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

  document.addEventListener('submit', handler, true);

  return () => {
    document.removeEventListener('submit', handler, true);
  };
}
