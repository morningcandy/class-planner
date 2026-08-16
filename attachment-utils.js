(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ClassPlannerAttachments = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = {
    maxFiles: 5,
    maxFileBytes: 6 * 1024 * 1024,
    maxTotalBytes: 15 * 1024 * 1024,
    allowedName: /\.(pdf|xlsx|csv|txt|png|jpe?g|webp|gif)$/i,
  };

  function fileKey(file) {
    return [file && file.name, file && file.size, file && file.lastModified].join('|');
  }

  function mergeFiles(current, selected, options) {
    const rules = Object.assign({}, DEFAULTS, options || {});
    const previous = Array.isArray(current) ? current.slice() : [];
    const incoming = Array.from(selected || []);
    const invalid = incoming.find((file) => !rules.allowedName.test(String(file && file.name || '')) || Number(file && file.size) > rules.maxFileBytes);
    if (invalid) {
      return { files: previous, error: `${invalid.name}: 지원 형식과 6MB 제한을 확인해주세요.` };
    }

    const known = new Set(previous.map(fileKey));
    const merged = previous.slice();
    incoming.forEach((file) => {
      const key = fileKey(file);
      if (!known.has(key)) {
        known.add(key);
        merged.push(file);
      }
    });
    if (merged.length > rules.maxFiles) {
      return { files: previous, error: `첨부파일은 최대 ${rules.maxFiles}개까지 가능합니다.` };
    }
    if (merged.reduce((sum, file) => sum + Number(file && file.size || 0), 0) > rules.maxTotalBytes) {
      return { files: previous, error: '첨부파일 전체 크기는 15MB 이하여야 합니다.' };
    }
    return { files: merged, error: '' };
  }

  return { mergeFiles, fileKey };
}));
