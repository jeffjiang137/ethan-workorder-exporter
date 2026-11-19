(() => {
  'use strict';
  if (window.__ethanAcceptanceTimeWatcher) return;
  window.__ethanAcceptanceTimeWatcher = true;
  const watched = new WeakMap();
  const toolbarStyle = document.createElement('style');
  toolbarStyle.textContent = `
    .ethan-edit-dialog>.el-dialog__header{box-sizing:border-box;min-height:52px!important;padding-top:16px!important;padding-bottom:10px!important}
    .ethan-edit-dialog>.el-dialog__body{padding-top:0!important}
    .ethan-dialog-tool{top:6px!important;width:40px!important;height:40px!important;border:0!important;border-radius:8px!important;background:transparent!important;color:#78838f!important;cursor:pointer!important;box-shadow:none!important;transition:background .15s,color .15s,box-shadow .15s!important}
    .ethan-dialog-tool:hover{background:#edf7f2!important;color:#0b995f!important}
    .ethan-dialog-tool:active{background:#dcefe5!important;box-shadow:inset 0 1px 3px #163b2420!important}
    .ethan-dialog-tool:focus-visible{outline:2px solid #13b874!important;outline-offset:2px!important}
    .ethan-dialog-tool.ethan-dialog-close{right:12px!important}
    .ethan-dialog-close:hover{background:#fff0f0!important;color:#da4444!important}
    .ethan-dialog-close:active{background:#ffe0e0!important}
    .ethan-dialog-tool[data-ethan-dialog-snapshot]{right:60px!important}
    .ethan-dialog-tool:disabled{opacity:.45;cursor:wait!important}
    .ethan-dialog-tool svg{width:18px;height:18px;pointer-events:none}
    .ethan-dialog-tool i{font-size:18px!important;line-height:1!important}
    @media(prefers-reduced-motion:reduce){.ethan-dialog-tool{transition:none!important}}
  `;
  document.head.appendChild(toolbarStyle);

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
      dialog.classList.add('ethan-edit-dialog');
      const header = dialog.querySelector('.el-dialog__header');
      const closeIcon = header?.querySelector('.el-dialog__close, .el-icon-close');
      const closeButton = closeIcon?.closest('button, .el-dialog__headerbtn');
      if (closeButton && !closeButton.dataset.ethanLargerClose) {
        closeButton.dataset.ethanLargerClose = 'true';
        closeButton.style.cssText += ';position:absolute;top:4px;right:8px;width:40px;height:40px;padding:0;display:flex;align-items:center;justify-content:center;';
        closeButton.setAttribute('aria-label', '关闭编辑窗口');
        closeButton.title = '关闭';
        closeButton.classList.add('ethan-dialog-tool', 'ethan-dialog-close');
        // Keep fullscreen controls clear of the enlarged close hit area.
        const controls = Array.from(header.querySelectorAll('button, .el-dialog__headerbtn'))
          .filter(control => control !== closeButton && !control.contains(closeButton) && !closeButton.contains(control));
        controls.forEach((control, index) => {
          control.classList.add('ethan-dialog-tool');
          control.title = '切换全屏';
          control.setAttribute('aria-label', '切换全屏');
          control.style.cssText += ';position:absolute;top:8px;right:' + (108 + index * 44) + 'px;width:32px;height:32px;padding:0;display:flex;align-items:center;justify-content:center;';
        });
        header.style.paddingRight = (152 + Math.max(0, controls.length - 1) * 44) + 'px';
      }
      if (header && !header.querySelector('[data-ethan-dialog-snapshot]')) {
        const snapshot = document.createElement('button');
        snapshot.type = 'button';
        snapshot.dataset.ethanDialogSnapshot = '';
        snapshot.classList.add('ethan-dialog-tool');
        snapshot.title = '快照并复制弹窗';
        snapshot.setAttribute('aria-label', snapshot.title);
        snapshot.style.cssText = 'position:absolute;top:8px;right:60px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:4px;background:transparent;color:#909399;cursor:pointer';
        snapshot.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 6.5h4l1.5-2h5l1.5 2h4a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 19V8A1.5 1.5 0 0 1 4 6.5Z"/><circle cx="12" cy="13" r="4"/></svg>';
        header.appendChild(snapshot);
      }
      const acceptanceItem = field(dialog, '资料验收');
      const acceptanceControl = component(acceptanceItem, 'ElDatePicker') || component(acceptanceItem, 'ElInput');
      const acceptanceInput = acceptanceControl?.$el.querySelector('input');
      if (acceptanceInput && !acceptanceItem.querySelector('[data-ethan-now]')) {
        const host = acceptanceControl.$el;
        host.style.position = 'relative';
        acceptanceInput.style.paddingRight = '62px';
        const nowButton = document.createElement('button');
        nowButton.type = 'button';
        nowButton.dataset.ethanNow = '';
        nowButton.textContent = '此刻';
        nowButton.style.cssText = 'position:absolute;right:28px;top:0;bottom:0;margin:auto 0;height:20px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;z-index:2;border:0;background:transparent;color:#13b874;padding:0 2px;font-size:12px;cursor:pointer;line-height:20px';
        nowButton.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          if (acceptanceControl.disabled || acceptanceControl.readonly || acceptanceControl.pickerDisabled
              || acceptanceInput.disabled || acceptanceInput.readOnly) return;
          const now = new Date();
          const pad = value => String(value).padStart(2, '0');
          const text = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
          const form = dialog.querySelector('.el-form')?.__vue__;
          if (form?.model) form.$set(form.model, 'cust_service_list-data_check', text);
          const value = acceptanceControl.$options.name === 'ElInput' || acceptanceControl.valueFormat ? text : now;
          acceptanceControl.$emit('input', value);
          acceptanceControl.$emit('change', value);
        });
        host.appendChild(nowButton);
        // ElInput is inline-block: its wrapper can include baseline whitespace.
        // Anchor to the input border box rather than the wrapper height.
        const alignNowButton = () => {
          const inputRect = acceptanceInput.getBoundingClientRect();
          const hostRect = host.getBoundingClientRect();
          nowButton.style.top = (inputRect.top - hostRect.top - host.clientTop) + 'px';
          nowButton.style.height = inputRect.height + 'px';
          nowButton.style.bottom = 'auto';
          nowButton.style.margin = '0';
        };
        alignNowButton();
        const sizeObserver = new ResizeObserver(alignNowButton);
        sizeObserver.observe(acceptanceInput);
        acceptanceControl.$once('hook:beforeDestroy', () => sizeObserver.disconnect());
      }
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
