(() => {
  'use strict';
  if (window.__ethanAcceptanceTimeWatcher) return;
  window.__ethanAcceptanceTimeWatcher = true;
  const watched = new WeakMap();
  const editorSessions = new WeakMap();
  const retainedDrafts = new Map();
  const preservingDraft = new WeakSet();
  const toolbarStyle = document.createElement('style');
  toolbarStyle.textContent = `
    .ethan-edit-dialog>.el-dialog__header{box-sizing:border-box;min-height:52px!important;padding-top:16px!important;padding-bottom:10px!important}
    .ethan-edit-dialog>.el-dialog__body{padding-top:0!important}
    .ethan-copy-company-row,.ethan-copy-company-row .el-form-item__label{cursor:pointer}
    .ethan-copy-company-row input:disabled{pointer-events:none}
    .ethan-feedback-phrases{position:absolute;left:calc(100% + 6px);bottom:16px;z-index:2;box-sizing:border-box;width:164px;padding:10px;background:#fff;border:1px solid #dce5df;border-radius:6px;box-shadow:0 4px 16px #0002;color:#303133}
    .ethan-feedback-phrases[hidden],.ethan-edit-dialog:has([data-ethan-dialog-snapshot][aria-busy="true"]) .ethan-feedback-phrases{display:none}
    .ethan-feedback-phrases{width:184px;max-height:70vh;overflow:auto}
    .ethan-phrase-header,.ethan-phrase-row{display:flex;align-items:center;gap:3px}
    .ethan-phrase-header strong{flex:1;font-size:13px}
    .ethan-phrase-row>button:first-child{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ethan-feedback-phrases .ethan-phrase-tool{width:auto;flex:none;padding:4px}
    .ethan-phrase-edit{opacity:0}
    .ethan-phrase-row:hover .ethan-phrase-edit,.ethan-phrase-row:focus-within .ethan-phrase-edit{opacity:1}
    .ethan-feedback-phrases .ethan-phrase-delete{color:#c53030}
    .ethan-phrase-editor{width:100%;box-sizing:border-box;margin:4px 0;padding:7px;border:1px solid #dce5df;border-radius:6px;background:#f5faf7}
    .ethan-phrase-editor input{width:100%;box-sizing:border-box;padding:5px 6px;border:1px solid #cadbd1;border-radius:4px;background:#fff;color:#303133;font-family:inherit;font-size:12px;line-height:1.5}
    .ethan-phrase-editor input:focus{outline:1px solid #13a66a;border-color:#13a66a}
    .ethan-phrase-editor-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:5px}
    .ethan-phrase-editor-actions .ethan-phrase-tool{padding:4px 8px}
    .ethan-phrase-editor-actions .ethan-phrase-confirm{background:#e0f3e9}
    .ethan-feedback-phrases button{display:block;width:100%;padding:5px 7px;border:0;border-radius:4px;background:transparent;text-align:left;color:#08794e;cursor:pointer;font-size:12px}
    .ethan-feedback-phrases button:is(:hover,:focus-visible){background:#e4f3eb}
    @media(max-width:960px){.ethan-feedback-phrases{position:static;width:auto;margin:0 12px 12px}.ethan-feedback-phrases button{display:inline-block;width:auto}}
    .ethan-edit-dialog.is-fullscreen .ethan-feedback-phrases{position:static;width:auto;margin:0 12px 12px}
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
    .ethan-ai-select{display:none!important}
    .ethan-ai-toggle.el-input__inner{display:block;width:100%;height:28px;line-height:26px;font-size:12px;text-align:left;cursor:pointer}
    .ethan-status-host{position:relative}
    .ethan-status-host .el-input__inner{padding-right:145px;text-overflow:ellipsis}
    .el-row:has(>.el-col .ethan-status-host):has(>.el-col .ethan-result-field)>.el-col:has(.ethan-status-host){width:59%}
    .el-row:has(>.el-col .ethan-status-host):has(>.el-col .ethan-result-field)>.el-col:has(.ethan-result-field){width:41%}
    .ethan-status-actions{position:absolute;right:26px;top:50%;transform:translateY(-50%);display:flex;gap:6px;z-index:1}
    .ethan-status-actions button{border:0;background:transparent;color:#13a66a;font:inherit;font-size:12px;line-height:20px;padding:0 2px;cursor:pointer;white-space:nowrap}
    .ethan-status-actions button:hover{color:#087e4e;text-decoration:underline}
    .ethan-status-actions button:disabled{opacity:.45;cursor:not-allowed}
    .ethan-ai-toggle[aria-pressed="true"]{background:#f0f9f4;border-color:#b7dfc7;color:#17834f}
    .ethan-ai-toggle:focus-visible{outline:2px solid #13b874;outline-offset:2px}
    .ethan-ai-toggle:disabled{cursor:not-allowed;opacity:.6}
    @media(prefers-reduced-motion:reduce){.ethan-dialog-tool{transition:none!important}}
  `;
  document.head.appendChild(toolbarStyle);

  function field(dialog, label) {
    const item = Array.from(dialog.querySelectorAll('.el-form-item')).find(node =>
      node.querySelector('.el-form-item__label')?.textContent.replace(/[\s*：:]/g, '').replace(/帐号/g, '账号') === label);
    return item;
  }

  function component(item, name) {
    return Array.from(item?.querySelectorAll('*') || [])
      .map(node => node.__vue__).find(vm => vm?.$options.name === name);
  }

  const confirmationPickers = new WeakSet();
  const confirmationPanels = new WeakSet();

  function installTimeConfirmation(dialog) {
    for (const label of ['资料验收', '计划完成', '完成时间']) {
      const picker = component(field(dialog, label), 'ElDatePicker');
      if (picker?.type !== 'datetime' || confirmationPickers.has(picker)) continue;
      confirmationPickers.add(picker);

      const showPicker = picker.showPicker;
      picker.showPicker = function (...args) {
        showPicker.apply(this, args);
        const panel = this.picker;
        if (!panel || typeof panel.confirm !== 'function') return;
        if (!confirmationPanels.has(panel)) {
          confirmationPanels.add(panel);
          const emit = panel.$emit;
          const confirm = panel.confirm;
          let confirming = false;
          panel.confirm = function (...confirmArgs) {
            confirming = true;
            try {
              return confirm.apply(this, confirmArgs);
            } finally {
              confirming = false;
            }
          };
          panel.$emit = function (event, ...eventArgs) {
            if (event !== 'pick' || !picker.pickerVisible) return emit.call(this, event, ...eventArgs);
            const [date] = eventArgs;
            if (confirming && this.isValidValue(date)) return emit.call(this, event, ...eventArgs);
            if (!confirming && date instanceof Date && !Number.isNaN(date.getTime())) {
              this.date = this.value = date;
            }
            return this;
          };
        }
        // Keep the opening time local to the panel until its confirmation action.
        panel.date = panel.value = new Date();
        panel.userInputDate = panel.userInputTime = null;
        panel.timePickerVisible = false;
      };

      const handleChange = picker.handleChange;
      picker.handleChange = function (...args) {
        if (!this.pickerVisible) return handleChange.apply(this, args);
        if (this.userInput && confirmationPanels.has(this.picker)) {
          const date = this.parseString(this.displayValue);
          if (this.isValidValue(date)) this.picker.date = this.picker.value = date;
        }
        this.userInput = null;
      };
    }
  }

  function installFeedbackPhrases(dialog) {
    const input = field(dialog, '情况反馈')?.querySelector('textarea');
    const existing = dialog.querySelector('.ethan-feedback-phrases');
    if (existing?.feedbackInput === input) return;
    existing?.remove();
    if (!input) return;

    const card = document.createElement('div');
    card.className = 'ethan-feedback-phrases';
    card.feedbackInput = input;
    card.hidden = document.activeElement !== input;
    const title = document.createElement('strong');
    title.textContent = '快捷填入';
    const header = document.createElement('div');
    header.className = 'ethan-phrase-header';
    const list = document.createElement('div');
    header.append(title);
    card.append(header, list);

    const mobileSyncPhrase = '手机端同步加积分0.2';
    const defaultPhrases = [
      '发给店长', '扣首页', '海报', '扣模板', '扣主图', '扣信息', '扣图片', '数量不够已反馈',
      '不用上传', '店长上传', '高版本', mobileSyncPhrase, '抠图', '不抠图'
    ].map(text => ({ text, mobileSync: text === mobileSyncPhrase }));
    const storageKey = 'ethan.feedbackPhrases.v1';
    let phrases = defaultPhrases;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (Array.isArray(saved) && saved.every(item => typeof item?.text === 'string')) phrases = saved;
    } catch {}
    let deleting = false;
    let draft;
    function savePhrases(next) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
        phrases = next;
        return true;
      } catch {
        window.alert('快捷短语保存失败，请重试。');
        return false;
      }
    }
    const currentMonthDay = () => {
      const today = new Date();
      return (today.getMonth() + 1) + '.' + today.getDate();
    };
    const dateButton = document.createElement('button');
    dateButton.textContent = currentMonthDay();
    function bindInsert(button, phrase) {
      button.type = 'button';
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => {
        if (input.disabled || input.readOnly) return;
        if (button === dateButton) dateButton.textContent = currentMonthDay();
        const value = input.value;
        const isMobileSync = phrase?.mobileSync;
        const session = editorSessions.get(dialog);
        let points;
        let nextPoints;
        let completeButton;
        if (isMobileSync) {
          if (!session || session.mobileSyncApplied || value.includes(mobileSyncPhrase) || value.includes(phrase.text)) return;
          completeButton = field(dialog, '操作状态')?.querySelector('.ethan-status-complete');
          if (!completeButton) return;
          points = component(field(dialog, '工作积分'), 'ElInputNumber');
          if (!points || points.disabled || points.inputNumberDisabled ||
              typeof points.setCurrentValue !== 'function' || !Number.isFinite(points.currentValue)) return;
          nextPoints = Number((points.currentValue + 0.2).toPrecision(15));
          if (nextPoints > points.max || nextPoints < points.min ||
              (typeof points.precision === 'number' && Number(nextPoints.toFixed(points.precision)) !== nextPoints)) return;
        }
        const caret = input.selectionStart;
        const before = value.slice(0, caret);
        const after = value.slice(caret);
        const prefix = before && !/[\s，。；、,.!?！？;]$/.test(before) ? ' ' : '';
        const suffix = after && !/^[\s，。；、,.!?！？;]/.test(after) ? '，' : '';
        const addition = prefix + button.textContent + suffix;
        if (input.maxLength >= 0 && value.length + addition.length > input.maxLength) return;
        input.focus({ preventScroll: true });
        input.setSelectionRange(caret, caret);
        // Use the browser's editing command so Ctrl+Z can undo the insertion.
        if (!document.execCommand('insertText', false, addition)) return;
        if (isMobileSync) {
          points.setCurrentValue(nextPoints);
          session.mobileSyncApplied = true;
          completeButton.click();
        }
        if (suffix) {
          const end = caret + addition.length - suffix.length;
          input.setSelectionRange(end, end);
        }
      });
    }
    bindInsert(dateButton);
    function tool(symbol, label, action, className = '') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ethan-phrase-tool ' + className;
      button.textContent = symbol;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', action);
      return button;
    }
    function editPhrase(index, row) {
      const box = document.createElement('div');
      box.className = 'ethan-phrase-editor';
      const editor = document.createElement('input');
      editor.type = 'text';
      editor.value = phrases[index]?.text ?? '';
      editor.placeholder = '输入短语';
      editor.setAttribute('aria-label', editor.placeholder);
      const actions = document.createElement('div');
      actions.className = 'ethan-phrase-editor-actions';
      const closeEditor = () => {
        input.focus({ preventScroll: true });
        render();
      };
      const confirmEdit = () => {
        const text = editor.value.trim();
        if (!text) {
          editor.focus();
          return;
        }
        const next = [...phrases];
        next[index] = { ...next[index], text };
        if (savePhrases(next)) closeEditor();
      };
      actions.append(tool('取消', '取消编辑短语', closeEditor),
        tool('确认', '保存短语', confirmEdit, 'ethan-phrase-confirm'));
      box.append(editor, actions);
      row.append(box);
      editor.focus();
      editor.select();
      editor.addEventListener('keydown', event => {
        if (event.isComposing || !['Enter', 'Escape'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Enter') confirmEdit();
        else closeEditor();
      });
    }
    const add = tool('+', '新增短语', () => {
      render(card.querySelector('.ethan-phrase-editor') ? -1 : phrases.length);
    });
    const remove = tool('−', '管理删除', () => {
      if (deleting && !savePhrases(draft)) return;
      deleting = !deleting;
      draft = deleting ? [...phrases] : null;
      render();
    });
    header.append(add, remove);
    function render(editIndex = -1) {
      if (list.contains(document.activeElement)) input.focus({ preventScroll: true });
      add.disabled = deleting;
      remove.textContent = deleting ? '保存' : '−';
      remove.title = deleting ? '保存短语列表' : '管理删除';
      remove.setAttribute('aria-label', remove.title);
      list.replaceChildren();
      const entries = deleting ? draft : phrases;
      entries.forEach((phrase, index) => {
        const row = document.createElement('div');
        row.className = 'ethan-phrase-row';
        list.append(row);
        if (index === editIndex) {
          editPhrase(index, row);
          return;
        }
        const button = document.createElement('button');
        button.textContent = phrase.text;
        button.title = phrase.text;
        bindInsert(button, phrase);
        button.disabled = deleting;
        row.append(button, deleting
          ? tool('×', '删除 ' + phrase.text, () => {
            draft.splice(index, 1);
            remove.focus();
            render();
          }, 'ethan-phrase-delete')
          : tool('✎', '编辑 ' + phrase.text, () => render(index), 'ethan-phrase-edit'));
      });
      list.append(dateButton);
      dateButton.disabled = deleting;
      if (editIndex === phrases.length) editPhrase(editIndex, list);
    }
    const hideAfterFocusLeaves = event => {
      if (event.relatedTarget !== input && !card.contains(event.relatedTarget)) card.hidden = true;
    };
    input.addEventListener('focus', () => {
      dateButton.textContent = currentMonthDay();
      card.hidden = input.disabled || input.readOnly;
    });
    input.addEventListener('focusout', hideAfterFocusLeaves);
    card.addEventListener('focusout', hideAfterFocusLeaves);
    dialog.append(card);
    render();
  }

  function installAiProjectToggle(dialog) {
    const item = field(dialog, 'AI项目');
    const select = component(item, 'ElSelect');
    if (!select || select.multiple || typeof select.handleOptionSelect !== 'function'
        || item.querySelector('.ethan-ai-toggle')) return;

    const optionFor = label => select.options.find(option => String(option.currentLabel).trim() === label);
    if (!optionFor('是') || !optionFor('否')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'el-input__inner ethan-ai-toggle';
    const nextOption = () => optionFor(select.value === optionFor('是')?.value ? '否' : '是');
    const isDisabled = option => select.selectDisabled || select.disabled || !option
      || option.disabled || option.groupDisabled;
    const sync = () => {
      const yes = select.value === optionFor('是')?.value;
      button.textContent = yes ? '是' : '否';
      button.setAttribute('aria-label', 'AI项目');
      button.setAttribute('aria-pressed', String(yes));
      button.disabled = Boolean(isDisabled(nextOption()));
    };

    button.addEventListener('click', () => {
      const option = nextOption();
      if (isDisabled(option)) return;
      // Use the original option handler so v-model and form change listeners still run.
      select.handleOptionSelect(option);
    });
    select.$watch('value', sync);
    select.$watch('selectDisabled', sync);
    select.$watch('options', sync);
    select.$once('hook:beforeDestroy', () => button.remove());
    sync();
    select.$el.classList.add('ethan-ai-select');
    select.$el.after(button);
  }

  function installStatusShortcuts(status, setShortcut) {
    if (typeof status.handleOptionSelect !== 'function') return () => {};
    const host = status.$el;
    const actions = document.createElement('div');
    actions.className = 'ethan-status-actions';
    const confirm = document.createElement('button');
    const complete = document.createElement('button');
    const publish = document.createElement('button');
    complete.className = 'ethan-status-complete';
    confirm.type = complete.type = publish.type = 'button';
    const optionFor = (...labels) => status.options.find(option =>
      labels.includes(String(option.currentLabel).trim()));
    const confirmOption = () => optionFor('等待客户确认', '待客户确认', '待确认');
    const completeOption = () => optionFor('处理完成') || optionFor('已完成');
    const publishOption = () => optionFor('等待助理发布', '待助理发布');
    const isConfirm = () => confirmOption() && status.value === confirmOption().value;
    const target = () => isConfirm() ? optionFor('等待处理') : confirmOption();
    const disabled = option => status.disabled || status.selectDisabled || !option
      || option.disabled || option.groupDisabled || option.value === status.value;

    function choose(event, option, clear = false) {
      event.stopPropagation();
      if (disabled(option)) return;
      setShortcut({ value: option.value, clear });
      try { status.handleOptionSelect(option); }
      finally { setShortcut(null); }
    }

    confirm.addEventListener('click', event => choose(event, target(), Boolean(isConfirm())));
    complete.addEventListener('click', event => choose(event, completeOption()));
    publish.addEventListener('click', event => choose(event, publishOption()));
    complete.textContent = '完成';
    publish.textContent = '待发布';
    const sync = () => {
      const label = isConfirm() ? '待处理' : '待确认';
      if (confirm.textContent !== label) confirm.textContent = label;
      confirm.disabled = Boolean(disabled(target()));
      complete.disabled = Boolean(disabled(completeOption()));
      publish.disabled = Boolean(disabled(publishOption()));
    };
    actions.append(publish, confirm, complete);
    host.classList.add('ethan-status-host');
    host.append(actions);
    sync();
    const stops = ['value', 'options', 'selectDisabled'].map(key => status.$watch(key, sync));
    return () => {
      stops.forEach(stop => stop());
      actions.remove();
      host.classList.remove('ethan-status-host');
    };
  }

  function trackEditorDraft(dialog) {
    const form = dialog.querySelector('.el-form')?.__vue__;
    const model = form?.model;
    const id = model?.id ?? model?.['cust_service_list-id'];
    if (id == null) return;
    const existing = editorSessions.get(dialog);
    if (existing?.model === model && existing.id === id) return;

    const savedDraft = retainedDrafts.get(id);
    const original = structuredClone(model);
    if (savedDraft) {
      for (const [key, value] of Object.entries(savedDraft.changes)) {
        if (savedDraft.model === model) original[key] = savedDraft.original[key];
        form.$set(model, key, structuredClone(value));
      }
    }
    const session = { id, model, original };
    editorSessions.set(dialog, session);

    const wrapper = dialog.closest('.el-dialog__wrapper');
    if (!wrapper || wrapper.dataset.ethanDraftEvents) return;
    wrapper.dataset.ethanDraftEvents = 'true';
    wrapper.addEventListener('click', event => {
      const currentDialog = wrapper.querySelector('.el-dialog');
      const active = editorSessions.get(currentDialog);
      const currentForm = currentDialog?.querySelector('.el-form')?.__vue__;
      if (!active || currentForm?.model !== active.model) return;
      const { id, model, original } = active;

      const button = event.target.closest?.('button');
      if (button?.classList.contains('ethan-dialog-close')) {
        if (preservingDraft.has(currentDialog)) return;
        retainedDrafts.delete(id);
        for (const [key, value] of Object.entries(original)) {
          if (JSON.stringify(model[key]) !== JSON.stringify(value)) {
            currentForm.$set(model, key, structuredClone(value));
          }
        }
      } else if (button?.textContent.includes('确认提交')) {
        retainedDrafts.delete(id);
      }
    }, true);
  }

  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest(
      '.el-dialog, .el-select-dropdown, .el-picker-panel, .el-cascader__dropdown, .el-popover, .el-message-box__wrapper'
    )) return;

    const visibleDialogs = [...document.querySelectorAll('.el-dialog')]
      .filter(dialog => dialog.getClientRects().length);
    const dialog = visibleDialogs.at(-1);
    const session = editorSessions.get(dialog);
    const close = dialog?.querySelector('.ethan-dialog-close');
    if (!session || !close || close.disabled) return;

    const { id, model, original } = session;
    const changes = Object.fromEntries(Object.entries(model).filter(([key, value]) =>
      JSON.stringify(value) !== JSON.stringify(original[key])));
    if (Object.keys(changes).length) {
      retainedDrafts.set(id, { model, original, changes: structuredClone(changes) });
    } else {
      retainedDrafts.delete(id);
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    // Use the same native close path as the header button, but skip cancellation.
    preservingDraft.add(dialog);
    try { close.click(); }
    finally { preservingDraft.delete(dialog); }
  }, true);

  function scan() {
    document.querySelectorAll('.el-dialog').forEach(dialog => {
      if (!dialog.getClientRects().length) {
        editorSessions.delete(dialog);
        return;
      }
      if (dialog.querySelector('.el-dialog__title')?.textContent.trim() !== '编辑') return;
      dialog.classList.add('ethan-edit-dialog');
      field(dialog, '处理结果')?.classList.add('ethan-result-field');
      if (field(dialog, '服务描述')) field(dialog, '公司名称')?.classList.add('ethan-copy-company-row');
      installFeedbackPhrases(dialog);
      installTimeConfirmation(dialog);
      installAiProjectToggle(dialog);
      const header = dialog.querySelector('.el-dialog__header');
      const closeIcon = header?.querySelector('.el-dialog__close, .el-icon-close');
      const closeButton = closeIcon?.closest('button, .el-dialog__headerbtn');
      trackEditorDraft(dialog);
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
      let shortcut = null;
      const form = dialog.querySelector('.el-form')?.__vue__;
      const writeTime = () => {
        if (!pending || pending.written || !dialog.getClientRects().length || status.value !== pending.status
            || form?.model?.id !== pending.id) return;
        const item = field(dialog, pending.label);
        const picker = component(item, 'ElDatePicker') || component(item, 'ElInput');
        const input = picker?.$el.querySelector('input');
        if (!picker || picker.disabled || picker.readonly || picker.pickerDisabled
            || !input || input.disabled || (picker.$options.name === 'ElInput' && input.readOnly)) return;
        const key = pending.label === '资料验收' ? 'cust_service_list-data_check' : 'cust_service_list-complete_time';
        // CustomEdit submits changes from ElForm.model, not the displayed input.
        if (form?.model && Object.prototype.hasOwnProperty.call(form.model, key)) {
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
        const label = String(status.options.find(option => option.value === value)?.currentLabel ?? value).trim();
        const acceptance = previous === '等待处理' && value === '处理中';
        // Loading a record updates the value watcher; only a change event can stamp a time.
        const fromShortcut = shortcut !== null && shortcut.value === value;
        const completion = (previous !== value && label === '等待助理发布')
          || (fromShortcut && !shortcut.clear);
        const clear = fromShortcut && shortcut.clear && label === '等待处理';
        if (!acceptance && !completion && !clear) return;
        const now = new Date();
        const pad = value => String(value).padStart(2, '0');
        const text = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        pending = { status: value, label: acceptance ? '资料验收' : '完成时间',
          id: form?.model?.id, now: clear ? null : now, text: clear ? '' : text, written: false };
        status.$nextTick(writeTime);
      };
      const beforeSubmit = event => {
        const button = event.target.closest?.('button');
        if (button?.classList.contains('ethan-dialog-close')) pending = null;
        else if (button?.textContent.includes('确认提交')) writeTime();
      };
      dialog.addEventListener('click', beforeSubmit, true);
      const stop = status.$watch('value', value => { previousValue = value; });
      status.$on('change', fillTime);
      const stopShortcuts = installStatusShortcuts(status, intent => { shortcut = intent; });
      watched.set(status, stop);
      status.$once('hook:beforeDestroy', () => {
        pending = null;
        stop();
        stopShortcuts();
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
