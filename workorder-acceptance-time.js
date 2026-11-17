(() => {
  'use strict';
  if (window.__ethanAcceptanceTimeWatcher) return;
  window.__ethanAcceptanceTimeWatcher = true;
  const watched = new WeakMap();

  function field(dialog, label) {
    const item = Array.from(dialog.querySelectorAll('.el-form-item')).find(node =>
      node.querySelector('.el-form-item__label')?.textContent.replace(/[\s*：:]/g, '') === label);
    return item;
  }

  function component(item, name) {
    return Array.from(item?.querySelectorAll('*') || [])
      .map(node => node.__vue__).find(vm => vm?.$options.name === name);
  }

  function scan() {
    document.querySelectorAll('.el-dialog').forEach(dialog => {
      if (!dialog.getClientRects().length || dialog.querySelector('.el-dialog__title')?.textContent.trim() !== '编辑') return;
      const status = component(field(dialog, '操作状态'), 'ElSelect');
      if (!status || watched.has(status)) return;
      let previousValue = status.value;
      let pending = null;
      const form = dialog.querySelector('.el-form')?.__vue__;
      const writeTime = () => {
        if (!pending || !dialog.getClientRects().length || status.value !== pending.status
            || form?.model?.id !== pending.id) return;
        const item = field(dialog, pending.label);
        const picker = component(item, 'ElDatePicker') || component(item, 'ElInput');
        const input = picker?.$el.querySelector('input');
        if (!picker || picker.disabled || picker.readonly || picker.pickerDisabled
            || !input || input.disabled || input.readOnly) return;
        const key = pending.label === '资料验收' ? 'cust_service_list-data_check' : 'cust_service_list-complete_time';
        // CustomEdit submits changes from ElForm.model, not the displayed input.
        if (form?.model && Object.prototype.hasOwnProperty.call(form.model, key)) {
          const current = form.model[key];
          // Preserve a subsequent manual edit of the timestamp.
          if (pending.written && current !== pending.original && current !== pending.text
              && current && !String(current).startsWith('1970-')) return;
          form.$set(form.model, key, pending.text);
        }
        const timeValue = picker.$options.name === 'ElInput' || picker.valueFormat ? pending.text : pending.now;
        picker.$emit('input', timeValue);
        picker.$emit('change', timeValue);
        pending.written = true;
      };
      const fillTime = value => {
        const previous = previousValue;
        previousValue = value;
        pending = null;
        if (!dialog.getClientRects().length) return;
        const acceptance = previous === '等待处理' && value === '处理中';
        const completion = ['待确认', '待客户确认', '等待客户确认', '已完成', '处理完成', '等待助理发布'].includes(value);
        if (!acceptance && !completion) return;
        const now = new Date();
        const pad = value => String(value).padStart(2, '0');
        const text = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        const key = acceptance ? 'cust_service_list-data_check' : 'cust_service_list-complete_time';
        pending = { status: value, label: acceptance ? '资料验收' : '完成时间',
          id: form?.model?.id, now, text, original: form?.model?.[key], written: false };
        status.$nextTick(writeTime);
      };
      const beforeSubmit = event => {
        const button = event.target.closest?.('button');
        if (button?.textContent.includes('确认提交')) writeTime();
      };
      dialog.addEventListener('click', beforeSubmit, true);
      const stop = status.$watch('value', value => { previousValue = value; });
      status.$on('change', fillTime);
      watched.set(status, stop);
      status.$once('hook:beforeDestroy', () => {
        pending = null;
        stop();
        status.$off('change', fillTime);
        dialog.removeEventListener('click', beforeSubmit, true);
      });
    });
  }
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; scan(); });
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  scan();
})();
