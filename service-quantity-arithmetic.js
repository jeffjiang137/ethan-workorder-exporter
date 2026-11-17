(() => {
  'use strict';
  if (window.__ethanServiceArithmetic) return;
  window.__ethanServiceArithmetic = true;

  function quantityField(target) {
    if (!(target instanceof HTMLInputElement) || target.disabled || target.readOnly) return null;
    const card = target.closest('.el-card');
    const serviceQuantity = card?.querySelector('.el-card__header')?.textContent.replace(/\s/g, '').includes('服务项目');
    const item = target.closest('.el-form-item');
    const workPoints = item?.querySelector('.el-form-item__label')?.textContent.replace(/[\s*：:]/g, '') === '工作积分';
    if (!serviceQuantity && !workPoints) return null;
    const vm = target.closest('.el-input-number')?.__vue__;
    return vm?.$options.name === 'ElInputNumber' && !vm.disabled ? vm : null;
  }

  function calculate(expression) {
    const text = expression.replace(/\s/g, '').replace(/×/g, '*').replace(/÷/g, '/');
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[+*/-][+-]?(?:\d+(?:\.\d+)?|\.\d+))+$/.test(text)) return null;
    const tokens = text.match(/(?:\d+(?:\.\d+)?|\.\d+)|[+*/-]/g);
    let index = 0;
    function number() {
      let sign = 1;
      if (tokens[index] === '+' || tokens[index] === '-') {
        if (tokens[index++] === '-') sign = -1;
      }
      return sign * Number(tokens[index++]);
    }
    function product() {
      let value = number();
      while (tokens[index] === '*' || tokens[index] === '/') {
        const operator = tokens[index++];
        const right = number();
        value = operator === '*' ? value * right : value / right;
      }
      return value;
    }
    let result = product();
    while (index < tokens.length) {
      const operator = tokens[index++];
      const right = product();
      result += operator === '+' ? right : -right;
    }
    return Number.isFinite(result) ? Number(result.toPrecision(15)) : null;
  }

  // Preserve an expression until Enter rather than letting InputNumber parse it early.
  document.addEventListener('input', event => {
    if (quantityField(event.target) && /\d\s*[+*/×÷-]/.test(event.target.value)) event.stopImmediatePropagation();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    const vm = quantityField(event.target);
    if (!vm || !/\d\s*[+*/×÷-]/.test(event.target.value)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const result = calculate(event.target.value);
    if (result === null || result < vm.min || result > vm.max) {
      event.target.setCustomValidity('请输入有效的加减乘除表达式，结果须在允许范围内');
      event.target.reportValidity();
      return;
    }
    event.target.setCustomValidity('');
    vm.setCurrentValue(result);
    vm.userInput = null;
    event.target.value = String(vm.currentValue);
  }, true);
})();
