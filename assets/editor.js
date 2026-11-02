(function () {
  'use strict';

  var PAGE_W = (210 * 96) / 25.4;
  var PAGE_H = (297 * 96) / 25.4;
  var PREVIEW_PADDING = 56;

  var DEFAULT_LAYOUT = {
    columns: 1,
    sideWidth: 33,
    density: 'compact',
    fontFamily: 'sans',
    fontSize: 10,
    lineHeight: 1.45,
    sectionGap: 11,
    pageMargin: 12,
    accent: '#1d4ed8',
    headerAlign: 'left',
    photoPosition: 'right',
    photoShape: 'rounded',
    photoWidth: 25,
    photoHeight: 32,
    titleStyle: 'line',
    tagStyle: 'soft',
    showPhoto: true
  };

  var DENSITY = {
    compact: { fontSize: 10, lineHeight: 1.45, sectionGap: 11, pageMargin: 12 },
    standard: { fontSize: 10.5, lineHeight: 1.55, sectionGap: 14, pageMargin: 14 },
    loose: { fontSize: 11.5, lineHeight: 1.7, sectionGap: 18, pageMargin: 16 }
  };

  var CLIENT_ID = (window.crypto && window.crypto.randomUUID)
    ? window.crypto.randomUUID()
    : 'client-' + Date.now() + '-' + Math.random().toString(36).slice(2);

  var state = {
    data: null,
    revision: 0,
    dirty: false,
    saving: false,
    changeVersion: 0,
    saveTimer: null,
    previewRaf: 0,
    pageOverflow: false,
    externalRevision: null,
    collapsed: new Set(),
    drag: null,
    photoBusy: false
  };

  var saveChain = Promise.resolve();
  var toastTimer = null;

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  var saveState;
  var saveText;
  var contentPanel;
  var layoutPanel;
  var sectionsList;
  var linksList;
  var photoPreview;
  var photoPlaceholder;
  var photoInput;
  var photoPicker;
  var removePhotoBtn;
  var jsonInput;
  var previewScroll;
  var pageScaler;
  var resumeRoot;
  var a4Limit;
  var overflowHint;
  var toast;
  var externalBanner;
  var moreBtn;
  var moreMenu;
  var pdfBtn;
  var wordBtn;
  var fitBtn;

  function init() {
    saveState = $('#saveState');
    saveText = $('#saveText');
    contentPanel = $('#contentPanel');
    layoutPanel = $('#layoutPanel');
    sectionsList = $('#sectionsList');
    linksList = $('#linksList');
    photoPreview = $('#photoPreview');
    photoPlaceholder = $('#photoPlaceholder');
    photoInput = $('#photoInput');
    photoPicker = $('#photoPicker');
    removePhotoBtn = $('#removePhotoBtn');
    jsonInput = $('#jsonInput');
    previewScroll = $('#previewScroll');
    pageScaler = $('#pageScaler');
    resumeRoot = $('#resumeRoot');
    a4Limit = $('#a4Limit');
    overflowHint = $('#overflowHint');
    toast = $('#toast');
    externalBanner = $('#externalBanner');
    moreBtn = $('#moreBtn');
    moreMenu = $('#moreMenu');
    pdfBtn = $('#pdfBtn');
    wordBtn = $('#wordBtn');
    fitBtn = $('#fitBtn');

    bindEvents();
    loadResume();
  }

  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function clamp(value, min, max, fallback) {
    var num = Number(value);
    if (!isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function normalizeData(raw) {
    var data = raw && typeof raw === 'object' ? raw : {};
    var profile = data.profile && typeof data.profile === 'object' ? data.profile : {};
    ['name', 'title', 'phone', 'email', 'location', 'photo', 'summary'].forEach(function (key) {
      profile[key] = profile[key] == null ? '' : String(profile[key]);
    });
    profile.links = Array.isArray(profile.links) ? profile.links.filter(function (link) {
      return link && typeof link === 'object';
    }).map(function (link) {
      return {
        label: link.label == null ? '' : String(link.label),
        url: link.url == null ? '' : String(link.url)
      };
    }) : [];
    data.profile = profile;

    data.sections = Array.isArray(data.sections) ? data.sections.filter(function (section) {
      return section && typeof section === 'object';
    }).map(function (section) {
      var out = {
        id: section.id ? String(section.id) : uid('sec'),
        title: section.title == null ? '' : String(section.title),
        type: section.type === 'tags' || section.type === 'list' ? section.type : 'timeline',
        visible: section.visible !== false,
        column: section.column === 'side' ? 'side' : 'main',
        items: Array.isArray(section.items) ? section.items.filter(function (item) {
          return item && typeof item === 'object';
        }).map(function (item) {
          return {
            id: item.id ? String(item.id) : uid('item'),
            title: item.title == null ? '' : String(item.title),
            subtitle: item.subtitle == null ? '' : String(item.subtitle),
            start: item.start == null ? '' : String(item.start),
            end: item.end == null ? '' : String(item.end),
            meta: item.meta == null ? '' : String(item.meta),
            link: item.link == null ? '' : String(item.link),
            description: item.description == null ? '' : String(item.description),
            bullets: Array.isArray(item.bullets) ? item.bullets.map(function (line) {
              return line == null ? '' : String(line);
            }) : [],
            tags: Array.isArray(item.tags) ? item.tags.map(function (tag) {
              return tag == null ? '' : String(tag);
            }) : []
          };
        }) : []
      };
      return out;
    }) : [];

    var layout = {};
    var source = data.layout && typeof data.layout === 'object' ? data.layout : {};
    Object.keys(DEFAULT_LAYOUT).forEach(function (key) {
      layout[key] = source[key] === undefined ? DEFAULT_LAYOUT[key] : source[key];
    });
    layout.columns = Number(layout.columns) === 2 ? 2 : 1;
    layout.sideWidth = clamp(layout.sideWidth, 22, 48, 33);
    layout.fontFamily = layout.fontFamily === 'serif' ? 'serif' : 'sans';
    layout.fontSize = clamp(layout.fontSize, 9, 13, 10);
    layout.lineHeight = clamp(layout.lineHeight, 1.3, 1.9, 1.45);
    layout.sectionGap = clamp(layout.sectionGap, 6, 24, 11);
    layout.pageMargin = clamp(layout.pageMargin, 8, 20, 12);
    layout.accent = /^#[0-9a-f]{3,8}$/i.test(layout.accent || '') ? layout.accent : '#1d4ed8';
    layout.headerAlign = layout.headerAlign === 'center' ? 'center' : 'left';
    layout.photoPosition = layout.photoPosition === 'left' ? 'left' : 'right';
    layout.photoShape = ['rounded', 'square', 'circle'].indexOf(layout.photoShape) >= 0 ? layout.photoShape : 'rounded';
    layout.photoWidth = clamp(layout.photoWidth, 18, 35, 25);
    layout.photoHeight = clamp(layout.photoHeight, 22, 42, 32);
    layout.titleStyle = ['line', 'underline', 'plain'].indexOf(layout.titleStyle) >= 0 ? layout.titleStyle : 'line';
    layout.tagStyle = ['soft', 'outline', 'plain'].indexOf(layout.tagStyle) >= 0 ? layout.tagStyle : 'soft';
    layout.showPhoto = layout.showPhoto !== false;
    layout.density = ['compact', 'standard', 'loose', 'custom'].indexOf(layout.density) >= 0 ? layout.density : 'compact';
    data.layout = layout;
    return data;
  }

  function loadResume() {
    fetch('/api/resume', { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      state.revision = Number(res.headers.get('X-Revision')) || 0;
      return res.json();
    }).then(function (data) {
      state.data = normalizeData(data);
      renderAll();
      setStatus('saved', '已保存');
      connectEvents();
    }).catch(function (err) {
      setStatus('error', '加载失败');
      showToast('无法加载 resume.json：' + err.message, 'error');
    });
  }

  function reloadFromServer(notify) {
    return fetch('/api/resume', { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      state.revision = Number(res.headers.get('X-Revision')) || 0;
      return res.json();
    }).then(function (data) {
      state.data = normalizeData(data);
      state.dirty = false;
      state.saving = false;
      state.changeVersion += 1;
      state.collapsed.clear();
      state.externalRevision = null;
      externalBanner.hidden = true;
      renderAll();
      setStatus('saved', '已保存');
      if (notify) showToast('已同步外部修改', 'success');
    }).catch(function (err) {
      showToast('同步失败：' + err.message, 'error');
    });
  }

  function connectEvents() {
    if (!window.EventSource) return;
    if (new URLSearchParams(location.search).get('noevents') === '1') return;
    var source = new EventSource('/api/events');
    source.addEventListener('update', function (event) {
      var payload;
      try {
        payload = JSON.parse(event.data);
      } catch (err) {
        return;
      }
      var revision = Number(payload.revision);
      if (!revision || revision <= state.revision) return;
      if (payload.source === CLIENT_ID) return;
      if (state.dirty || state.saving) {
        state.externalRevision = revision;
        externalBanner.hidden = false;
        return;
      }
      reloadFromServer(true);
    });
  }

  function setStatus(kind, text) {
    saveState.className = 'save-state ' + kind;
    saveText.textContent = text;
  }

  function showToast(message, kind) {
    toast.className = 'toast' + (kind ? ' ' + kind : '');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.hidden = true;
    }, 6000);
  }

  function markDirty() {
    state.changeVersion += 1;
    state.dirty = true;
    setStatus('dirty', '未保存');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () {
      saveNow();
    }, 550);
  }

  function saveNow() {
    clearTimeout(state.saveTimer);
    if (!state.data) return Promise.resolve(true);
    var task = saveChain.then(doSave, doSave);
    saveChain = task.then(function () {}, function () {});
    return task;
  }

  function doSave() {
    var version = state.changeVersion;
    var payload = JSON.stringify(state.data);
    state.saving = true;
    setStatus('saving', '保存中…');
    return fetch('/api/resume', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': CLIENT_ID
      },
      body: payload
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok) throw new Error(json.error || ('HTTP ' + res.status));
        state.revision = Number(json.revision) || state.revision;
        state.saving = false;
        if (state.changeVersion !== version) {
          state.dirty = true;
          setStatus('dirty', '未保存');
        } else {
          state.dirty = false;
          setStatus('saved', '已保存');
        }
        return true;
      });
    }).catch(function (err) {
      state.saving = false;
      state.dirty = true;
      setStatus('error', '保存失败');
      showToast('保存失败：' + err.message, 'error');
      return false;
    });
  }

  function renderAll() {
    renderProfileFields();
    renderLinks();
    renderPhoto();
    renderSections();
    renderPreviewNow();
    syncLayoutControls();
  }

  function renderProfileFields() {
    $$('[data-profile]', contentPanel).forEach(function (input) {
      input.value = state.data.profile[input.dataset.profile] || '';
    });
  }

  function renderPhoto() {
    var photo = state.data.profile.photo;
    if (photo) {
      photoPreview.src = photo;
      photoPreview.hidden = false;
      photoPlaceholder.hidden = true;
    } else {
      photoPreview.removeAttribute('src');
      photoPreview.hidden = true;
      photoPlaceholder.hidden = false;
    }
    removePhotoBtn.disabled = !photo;
  }

  function renderLinks() {
    var links = state.data.profile.links;
    if (!links.length) {
      linksList.innerHTML = '<div class="muted">还没有链接，可以添加 GitHub、作品集等。</div>';
      return;
    }
    linksList.innerHTML = links.map(function (link, index) {
      return '<div class="link-row" data-link-index="' + index + '">' +
        '<input data-link-field="label" value="' + esc(link.label) + '" placeholder="标签，如 GitHub">' +
        '<input data-link-field="url" value="' + esc(link.url) + '" placeholder="https://...">' +
        '<button type="button" data-action="remove-link" title="删除链接">×</button>' +
        '</div>';
    }).join('');
  }

  function typeOptions(current) {
    var options = [
      ['timeline', '经历 / 项目'],
      ['list', '列表'],
      ['tags', '技能标签']
    ];
    return options.map(function (pair) {
      return '<option value="' + pair[0] + '"' + (current === pair[0] ? ' selected' : '') + '>' + pair[1] + '</option>';
    }).join('');
  }

  function sectionHTML(section, index) {
    var items = section.items.map(function (item, itemIndex) {
      return itemHTML(section, item, itemIndex);
    }).join('');

    return '<section class="section-card' + (section.visible ? '' : ' is-hidden') + '" data-section-id="' + esc(section.id) + '">' +
      '<div class="section-head">' +
      '<span class="drag-handle" draggable="true" data-drag-section="' + esc(section.id) + '" title="拖拽排序">⠿</span>' +
      '<input class="section-name" data-field="title" value="' + esc(section.title) + '" aria-label="模块名称">' +
      '<div class="row-actions">' +
      '<button type="button" class="icon-btn" data-action="move-section-up" title="上移">↑</button>' +
      '<button type="button" class="icon-btn" data-action="move-section-down" title="下移">↓</button>' +
      '<button type="button" class="icon-btn danger" data-action="delete-section" title="删除模块">×</button>' +
      '</div>' +
      '</div>' +
      '<div class="section-meta-row">' +
      '<label>类型 <select data-field="type">' + typeOptions(section.type) + '</select></label>' +
      '<label title="双栏模式下生效">位置 <select data-field="column">' +
      '<option value="main"' + (section.column === 'main' ? ' selected' : '') + '>主栏</option>' +
      '<option value="side"' + (section.column === 'side' ? ' selected' : '') + '>侧栏</option>' +
      '</select></label>' +
      '<label class="mini-check"><input type="checkbox" data-field="visible"' + (section.visible ? ' checked' : '') + '>显示</label>' +
      '<span>' + section.items.length + ' 个条目</span>' +
      '</div>' +
      '<div class="section-fields">' + (items || '<div class="muted" style="padding:6px 2px">还没有条目</div>') + '</div>' +
      '<button type="button" class="add-item" data-action="add-item">+ 添加条目</button>' +
      '</section>';
  }

  function itemHTML(section, item, index) {
    var title = item.title || (section.type === 'tags' ? '未命名技能组' : '未填写');
    var open = !state.collapsed.has(item.id);
    var fields = section.type === 'tags' ? tagFields(item) : standardFields(item);

    return '<details class="item-card" data-item-id="' + esc(item.id) + '"' + (open ? ' open' : '') + '>' +
      '<summary class="item-summary">' +
      '<span class="item-caret">›</span>' +
      '<span class="drag-handle" draggable="true" data-drag-item="' + esc(item.id) + '" title="拖拽排序">⠿</span>' +
      '<span class="item-label">' + (index + 1) + '</span>' +
      '<span class="item-summary-title">' + esc(title) + '</span>' +
      '<span class="summary-actions">' +
      '<button type="button" class="icon-btn" data-action="move-item-up" title="上移">↑</button>' +
      '<button type="button" class="icon-btn" data-action="move-item-down" title="下移">↓</button>' +
      '<button type="button" class="icon-btn danger" data-action="delete-item" title="删除条目">×</button>' +
      '</span>' +
      '</summary>' +
      '<div class="item-fields">' + fields + '</div>' +
      '</details>';
  }

  function standardFields(item) {
    return '<div class="field-grid two">' +
      '<label class="field"><span>主标题</span><input data-item-field="title" value="' + esc(item.title) + '" placeholder="公司 / 学校 / 项目"></label>' +
      '<label class="field"><span>副标题</span><input data-item-field="subtitle" value="' + esc(item.subtitle) + '" placeholder="职位 / 专业 / 角色"></label>' +
      '</div>' +
      '<div class="field-grid three">' +
      '<label class="field"><span>开始</span><input data-item-field="start" value="' + esc(item.start) + '" placeholder="2023.06"></label>' +
      '<label class="field"><span>结束</span><input data-item-field="end" value="' + esc(item.end) + '" placeholder="至今"></label>' +
      '<label class="field"><span>地点 / 备注</span><input data-item-field="meta" value="' + esc(item.meta) + '" placeholder="上海"></label>' +
      '</div>' +
      '<label class="field"><span>链接（可选）</span><input data-item-field="link" value="' + esc(item.link) + '" placeholder="https://..."></label>' +
      '<label class="field"><span>一句话说明（可选）</span><textarea data-item-field="description" rows="2">' + esc(item.description) + '</textarea></label>' +
      '<label class="field"><span>要点（每行一条，建议量化结果）</span><textarea data-item-field="bullets" rows="3">' + esc(item.bullets.join('\n')) + '</textarea></label>' +
      '<label class="field"><span>标签（用逗号分隔）</span><input data-item-field="tags" value="' + esc(item.tags.join('、')) + '" placeholder="React、TypeScript"></label>';
  }

  function tagFields(item) {
    return '<div class="field-grid two">' +
      '<label class="field"><span>分组名称</span><input data-item-field="title" value="' + esc(item.title) + '" placeholder="如：前端"></label>' +
      '<label class="field"><span>标签（用逗号分隔）</span><input data-item-field="tags" value="' + esc(item.tags.join('、')) + '" placeholder="React、TypeScript"></label>' +
      '</div>' +
      '<label class="field"><span>补充说明（可选）</span><textarea data-item-field="description" rows="2">' + esc(item.description) + '</textarea></label>';
  }

  function renderSections() {
    if (!state.data) return;
    if (!state.data.sections.length) {
      sectionsList.innerHTML = '<div class="muted" style="padding:6px 2px">还没有模块，用下面的按钮添加。</div>';
      return;
    }
    sectionsList.innerHTML = state.data.sections.map(function (section, index) {
      return sectionHTML(section, index);
    }).join('');
  }

  function renderPreviewNow() {
    if (state.previewRaf) {
      cancelAnimationFrame(state.previewRaf);
      state.previewRaf = 0;
    }
    if (!state.data || !window.ResumeRenderer) return;
    window.ResumeRenderer.render(resumeRoot, state.data, { editor: true });
    updatePreviewScale();
  }

  function renderPreview() {
    if (state.previewRaf) return;
    state.previewRaf = requestAnimationFrame(function () {
      state.previewRaf = 0;
      if (!state.data) return;
      window.ResumeRenderer.render(resumeRoot, state.data, { editor: true });
      updatePreviewScale();
    });
  }

  function updatePreviewScale() {
    if (!state.data) return;
    var available = Math.max(120, previewScroll.clientWidth - PREVIEW_PADDING);
    var scale = Math.max(0.2, Math.min(1, available / PAGE_W));
    var pageHeight = resumeRoot.offsetHeight;
    var height = Math.max(pageHeight, PAGE_H);

    pageScaler.style.width = Math.round(PAGE_W * scale) + 'px';
    pageScaler.style.height = Math.round(height * scale) + 'px';
    resumeRoot.style.transform = 'scale(' + scale + ')';

    var overflow = pageHeight > PAGE_H + 3;
    state.pageOverflow = overflow;
    a4Limit.hidden = !overflow;
    a4Limit.style.top = Math.round(PAGE_H * scale) + 'px';

    if (overflow) {
      var excess = ((pageHeight - PAGE_H) * 25.4 / 96).toFixed(1);
      overflowHint.textContent = '超出 A4 约 ' + excess + 'mm，请压缩或点「适应一页」';
      overflowHint.className = 'overflow-hint';
    } else {
      overflowHint.textContent = '已在一页内';
      overflowHint.className = 'overflow-hint ok';
    }
  }

  function findSection(sectionId) {
    if (!state.data) return null;
    return state.data.sections.filter(function (section) {
      return section.id === sectionId;
    })[0] || null;
  }

  function findItem(section, itemId) {
    if (!section) return null;
    return section.items.filter(function (item) {
      return item.id === itemId;
    })[0] || null;
  }

  function parseTags(value) {
    return String(value || '').split(/[,，、;；\n]/).map(function (tag) {
      return tag.trim();
    }).filter(Boolean);
  }

  function parseBullets(value) {
    return String(value || '').split(/\n/).map(function (line) {
      return line.trim();
    }).filter(Boolean);
  }

  function onContentInput(event) {
    var target = event.target;
    if (!state.data) return;

    if (target.matches('[data-profile]')) {
      state.data.profile[target.dataset.profile] = target.value;
      renderPreview();
      markDirty();
      return;
    }

    if (target.matches('[data-link-field]')) {
      var row = target.closest('[data-link-index]');
      var link = state.data.profile.links[Number(row && row.dataset.linkIndex)];
      if (!link) return;
      link[target.dataset.linkField] = target.value;
      renderPreview();
      markDirty();
      return;
    }

    if (target.matches('[data-item-field]')) {
      var sectionEl = target.closest('[data-section-id]');
      var itemEl = target.closest('[data-item-id]');
      var section = findSection(sectionEl && sectionEl.dataset.sectionId);
      var item = findItem(section, itemEl && itemEl.dataset.itemId);
      if (!section || !item) return;
      var field = target.dataset.itemField;
      if (field === 'bullets') item.bullets = parseBullets(target.value);
      else if (field === 'tags') item.tags = parseTags(target.value);
      else item[field] = target.value;

      if (field === 'title') {
        var summaryTitle = itemEl.querySelector('.item-summary-title');
        if (summaryTitle) summaryTitle.textContent = target.value || (section.type === 'tags' ? '未命名技能组' : '未填写');
      }

      renderPreview();
      markDirty();
      return;
    }

    if (target.matches('[data-field]')) {
      var sectionCard = target.closest('[data-section-id]');
      section = findSection(sectionCard && sectionCard.dataset.sectionId);
      if (!section) return;
      var name = target.dataset.field;

      if (name === 'visible') {
        section.visible = target.checked;
        sectionCard.classList.toggle('is-hidden', !section.visible);
      } else if (name === 'type') {
        section.type = target.value;
        renderSections();
      } else if (name === 'column') {
        section.column = target.value === 'side' ? 'side' : 'main';
      } else if (name === 'title') {
        section.title = target.value;
      }

      renderPreview();
      markDirty();
    }
  }

  function onContentClick(event) {
    var button = event.target.closest('[data-action]');
    if (!button) return;
    var action = button.dataset.action;
    if (button.closest('.item-summary')) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (action === 'add-link') {
      state.data.profile.links.push({ label: '', url: '' });
      renderLinks();
      markDirty();
      var rows = $$('.link-row', linksList);
      var last = rows[rows.length - 1];
      if (last) last.querySelector('input').focus();
      return;
    }

    if (action === 'remove-link') {
      var row = button.closest('[data-link-index]');
      if (!row) return;
      state.data.profile.links.splice(Number(row.dataset.linkIndex), 1);
      renderLinks();
      renderPreview();
      markDirty();
      return;
    }

    if (action === 'reset-layout') {
      resetLayout();
      return;
    }

    var sectionCard = button.closest('[data-section-id]');
    var section = findSection(sectionCard && sectionCard.dataset.sectionId);
    if (!section) return;
    var itemCard = button.closest('[data-item-id]');
    var itemId = itemCard && itemCard.dataset.itemId;

    if (action === 'add-item') {
      var newItem = {
        id: uid('item'),
        title: '',
        subtitle: '',
        start: '',
        end: '',
        meta: '',
        link: '',
        description: '',
        bullets: [],
        tags: []
      };
      section.items.push(newItem);
      renderSections();
      renderPreviewNow();
      markDirty();
      focusItem(section.id, newItem.id);
      return;
    }

    if (action === 'delete-item') {
      if (!confirm('删除这个条目？')) return;
      section.items = section.items.filter(function (item) { return item.id !== itemId; });
      state.collapsed.delete(itemId);
      renderSections();
      renderPreviewNow();
      markDirty();
      return;
    }

    if (action === 'move-item-up' || action === 'move-item-down') {
      var index = section.items.findIndex(function (item) { return item.id === itemId; });
      var next = index + (action === 'move-item-up' ? -1 : 1);
      if (index < 0 || next < 0 || next >= section.items.length) return;
      var moved = section.items.splice(index, 1)[0];
      section.items.splice(next, 0, moved);
      renderSections();
      renderPreviewNow();
      markDirty();
      return;
    }

    if (action === 'delete-section') {
      if (!confirm('删除模块「' + (section.title || '未命名模块') + '」及其中所有条目？')) return;
      state.data.sections = state.data.sections.filter(function (item) { return item.id !== section.id; });
      renderSections();
      renderPreviewNow();
      markDirty();
      return;
    }

    if (action === 'move-section-up' || action === 'move-section-down') {
      var sectionIndex = state.data.sections.findIndex(function (item) { return item.id === section.id; });
      var targetIndex = sectionIndex + (action === 'move-section-up' ? -1 : 1);
      if (sectionIndex < 0 || targetIndex < 0 || targetIndex >= state.data.sections.length) return;
      var sectionMoved = state.data.sections.splice(sectionIndex, 1)[0];
      state.data.sections.splice(targetIndex, 0, sectionMoved);
      renderSections();
      renderPreviewNow();
      markDirty();
      return;
    }
  }

  function focusItem(sectionId, itemId) {
    requestAnimationFrame(function () {
      var card = $$('.item-card', sectionsList).filter(function (el) {
        return el.dataset.itemId === itemId;
      })[0];
      if (!card) return;
      card.open = true;
      state.collapsed.delete(itemId);
      card.scrollIntoView({ block: 'nearest' });
      var input = card.querySelector('[data-item-field="title"]');
      if (input) input.focus();
    });
  }

  function addSection(type, title) {
    var section = {
      id: uid('sec'),
      title: title || '自定义模块',
      type: type || 'timeline',
      visible: true,
      column: type === 'tags' && state.data.layout.columns === 2 ? 'side' : 'main',
      items: [{
        id: uid('item'),
        title: '',
        subtitle: '',
        start: '',
        end: '',
        meta: '',
        link: '',
        description: '',
        bullets: [],
        tags: []
      }]
    };
    state.data.sections.push(section);
    renderSections();
    renderPreviewNow();
    markDirty();
    var card = $$('.section-card', sectionsList).filter(function (el) {
      return el.dataset.sectionId === section.id;
    })[0];
    if (card) {
      card.scrollIntoView({ block: 'nearest' });
      var input = card.querySelector('.section-name');
      if (input) input.focus();
    }
  }

  function resetLayout() {
    if (!confirm('恢复默认版式？内容不会改变。')) return;
    state.data.layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
    syncLayoutControls();
    renderPreviewNow();
    markDirty();
    showToast('已恢复默认版式', 'success');
  }

  function applyDensity(key) {
    var layout = state.data.layout;
    if (key === 'custom') {
      layout.density = 'custom';
      return;
    }
    var preset = DENSITY[key];
    if (!preset) return;
    layout.density = key;
    layout.fontSize = preset.fontSize;
    layout.lineHeight = preset.lineHeight;
    layout.sectionGap = preset.sectionGap;
    layout.pageMargin = preset.pageMargin;
  }

  function onLayoutInput(event) {
    var id = event.target.id;
    var layout = state.data.layout;
    var changed = true;

    if (id === 'layoutSideWidth') layout.sideWidth = Number(event.target.value);
    else if (id === 'layoutFontSize') {
      layout.fontSize = Number(event.target.value);
      layout.density = 'custom';
    } else if (id === 'layoutLineHeight') {
      layout.lineHeight = Number(event.target.value);
      layout.density = 'custom';
    } else if (id === 'layoutSectionGap') {
      layout.sectionGap = Number(event.target.value);
      layout.density = 'custom';
    } else if (id === 'layoutPageMargin') {
      layout.pageMargin = Number(event.target.value);
      layout.density = 'custom';
    } else if (id === 'layoutPhotoWidth') {
      layout.photoWidth = Number(event.target.value);
    } else if (id === 'layoutPhotoHeight') {
      layout.photoHeight = Number(event.target.value);
    } else if (id === 'layoutAccent') {
      layout.accent = event.target.value;
    } else {
      changed = false;
    }

    if (!changed) return;
    refreshLayoutOutputs();
    layoutDensity.value = layout.density;
    renderPreview();
    markDirty();
  }

  function onLayoutChange(event) {
    var id = event.target.id;
    var layout = state.data.layout;

    if (id === 'layoutColumns') {
      layout.columns = Number(event.target.value) === 2 ? 2 : 1;
      syncLayoutControls();
    } else if (id === 'layoutDensity') {
      applyDensity(event.target.value);
      syncLayoutControls();
    } else if (id === 'layoutFontFamily') {
      layout.fontFamily = event.target.value === 'serif' ? 'serif' : 'sans';
    } else if (id === 'layoutHeaderAlign') {
      layout.headerAlign = event.target.value === 'center' ? 'center' : 'left';
    } else if (id === 'layoutTitleStyle') {
      layout.titleStyle = event.target.value;
    } else if (id === 'layoutTagStyle') {
      layout.tagStyle = event.target.value;
    } else if (id === 'layoutPhotoPosition') {
      layout.photoPosition = event.target.value === 'left' ? 'left' : 'right';
    } else if (id === 'layoutPhotoShape') {
      layout.photoShape = event.target.value;
    } else if (id === 'layoutShowPhoto') {
      layout.showPhoto = event.target.checked;
      syncLayoutControls();
    } else {
      return;
    }

    renderPreview();
    markDirty();
  }

  function refreshLayoutOutputs() {
    var layout = state.data.layout;
    $('#sideWidthOut').textContent = layout.sideWidth + '%';
    $('#fontSizeOut').textContent = (Math.round(layout.fontSize * 100) / 100) + 'pt';
    $('#lineHeightOut').textContent = Number(layout.lineHeight).toFixed(2);
    $('#sectionGapOut').textContent = layout.sectionGap + 'pt';
    $('#pageMarginOut').textContent = layout.pageMargin + 'mm';
    $('#photoWidthOut').textContent = layout.photoWidth + 'mm';
    $('#photoHeightOut').textContent = layout.photoHeight + 'mm';
  }

  function normalizeHex(value) {
    if (/^#[0-9a-f]{3}$/i.test(value)) {
      return '#' + value.slice(1).split('').map(function (ch) { return ch + ch; }).join('');
    }
    return /^#[0-9a-f]{6}$/i.test(value) ? value : '#1d4ed8';
  }

  function syncLayoutControls() {
    if (!state.data) return;
    var layout = state.data.layout;
    $('#layoutColumns').value = String(layout.columns);
    $('#layoutSideWidth').value = layout.sideWidth;
    $('#layoutFontFamily').value = layout.fontFamily;
    $('#layoutDensity').value = layout.density;
    $('#layoutFontSize').value = layout.fontSize;
    $('#layoutLineHeight').value = layout.lineHeight;
    $('#layoutSectionGap').value = layout.sectionGap;
    $('#layoutPageMargin').value = layout.pageMargin;
    $('#layoutAccent').value = normalizeHex(layout.accent);
    $('#layoutHeaderAlign').value = layout.headerAlign;
    $('#layoutTitleStyle').value = layout.titleStyle;
    $('#layoutTagStyle').value = layout.tagStyle;
    $('#layoutShowPhoto').checked = layout.showPhoto;
    $('#layoutPhotoPosition').value = layout.photoPosition;
    $('#layoutPhotoShape').value = layout.photoShape;
    $('#layoutPhotoWidth').value = layout.photoWidth;
    $('#layoutPhotoHeight').value = layout.photoHeight;
    refreshLayoutOutputs();
    updateLayoutDisabled();
  }

  function setControlDisabled(input, disabled) {
    input.disabled = disabled;
    var group = input.closest('.control');
    if (group) group.classList.toggle('is-disabled', disabled);
  }

  function updateLayoutDisabled() {
    var layout = state.data.layout;
    setControlDisabled($('#layoutSideWidth'), layout.columns === 1);
    var photoDisabled = !layout.showPhoto;
    ['#layoutPhotoPosition', '#layoutPhotoShape', '#layoutPhotoWidth', '#layoutPhotoHeight'].forEach(function (selector) {
      setControlDisabled($(selector), photoDisabled);
    });
  }

  function fitToPage() {
    renderPreviewNow();
    if (!state.pageOverflow) {
      showToast('已经在一页内，无需压缩', 'success');
      return;
    }

    var original = JSON.parse(JSON.stringify(state.data.layout));
    var attempts = [];
    for (var fs = Math.min(original.fontSize, 11); fs >= 9; fs -= 0.25) {
      attempts.push({
        fontSize: Math.round(fs * 100) / 100,
        lineHeight: Math.min(original.lineHeight, 1.45),
        sectionGap: Math.min(original.sectionGap, 10),
        pageMargin: Math.min(original.pageMargin, 12)
      });
    }
    [1.4, 1.35, 1.3].forEach(function (lineHeight) {
      [8, 6].forEach(function (gap) {
        [10, 9].forEach(function (margin) {
          attempts.push({ fontSize: 9, lineHeight: lineHeight, sectionGap: gap, pageMargin: margin });
        });
      });
    });

    var fitted = null;
    for (var i = 0; i < attempts.length; i += 1) {
      state.data.layout = Object.assign({}, original, attempts[i], { density: 'custom' });
      window.ResumeRenderer.render(resumeRoot, state.data, { editor: true });
      if (resumeRoot.offsetHeight <= PAGE_H + 2) {
        fitted = JSON.parse(JSON.stringify(state.data.layout));
        break;
      }
    }

    if (fitted) {
      state.data.layout = fitted;
      syncLayoutControls();
      renderPreviewNow();
      markDirty();
      showToast('已压缩到一页（字号 ' + fitted.fontSize + 'pt）', 'success');
    } else {
      state.data.layout = original;
      syncLayoutControls();
      renderPreviewNow();
      showToast('内容较多，压缩到 9pt 仍超出 A4，建议删减内容或改用双栏', 'error');
    }
  }

  function uploadPhoto(file) {
    if (!file) return;
    if (['image/png', 'image/jpeg', 'image/webp'].indexOf(file.type) < 0) {
      showToast('请选择 JPG、PNG 或 WebP 图片', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('图片不能超过 5MB', 'error');
      return;
    }

    readFileAsDataURL(file).then(function (dataUrl) {
      state.photoBusy = true;
      setStatus('saving', '上传照片中…');
      return fetch('/api/photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: dataUrl })
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok) throw new Error(json.error || ('HTTP ' + res.status));
        state.data.profile.photo = json.path;
        renderPhoto();
        renderPreviewNow();
        markDirty();
        return saveNow();
      });
    }).then(function () {
      state.photoBusy = false;
      showToast('照片已更新', 'success');
    }).catch(function (err) {
      state.photoBusy = false;
      setStatus('error', '上传失败');
      showToast('照片上传失败：' + err.message, 'error');
    });
  }

  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('读取文件失败')); };
      reader.readAsDataURL(file);
    });
  }

  function exportFile(kind) {
    renderPreviewNow();
    if (kind === 'pdf' && state.pageOverflow) {
      if (!confirm('内容超出 A4，导出的 PDF 会变成多页。仍要导出吗？')) return;
    }

    var wait = (state.dirty || state.saving) ? saveNow() : Promise.resolve(true);
    wait.then(function (ok) {
      if (!ok) {
        showToast('保存失败，已取消导出', 'error');
        return;
      }
      setExportBusy(true);
      return fetch('/api/export/' + kind, { method: 'POST' })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (json) {
            if (!res.ok) throw new Error(json.error || ('HTTP ' + res.status));
            showToast('已导出：' + json.file, 'success');
            triggerDownload(json.url);
          });
        })
        .catch(function (err) {
          showToast('导出失败：' + err.message, 'error');
        })
        .then(function () {
          setExportBusy(false);
        });
    });
  }

  function setExportBusy(busy) {
    pdfBtn.disabled = busy;
    wordBtn.disabled = busy;
    fitBtn.disabled = busy;
    if (busy) {
      setStatus('saving', '正在导出…');
    } else {
      setStatus(state.dirty ? 'dirty' : 'saved', state.dirty ? '未保存' : '已保存');
    }
  }

  function triggerDownload(url) {
    if (!url) return;
    var anchor = document.createElement('a');
    anchor.href = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'download=1';
    anchor.download = '';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function exportJson() {
    var blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    var date = new Date();
    var stamp = date.getFullYear() + String(date.getMonth() + 1).padStart(2, '0') + String(date.getDate()).padStart(2, '0');
    anchor.href = url;
    anchor.download = '简历数据-' + stamp + '.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    showToast('已导出 JSON 备份', 'success');
  }

  function importJson(file) {
    if (!file) return;
    file.text().then(function (text) {
      var parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error('JSON 格式不正确');
      }
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.sections)) {
        throw new Error('文件里缺少 sections 模块数据');
      }
      if (!confirm('导入会覆盖当前内容，确定继续？')) return;
      state.data = normalizeData(parsed);
      state.changeVersion += 1;
      state.dirty = true;
      state.collapsed.clear();
      renderAll();
      return saveNow().then(function (ok) {
        if (ok) showToast('已导入数据', 'success');
      });
    }).catch(function (err) {
      showToast('导入失败：' + err.message, 'error');
    });
  }

  function openPrint() {
    var wait = (state.dirty || state.saving) ? saveNow() : Promise.resolve(true);
    wait.then(function (ok) {
      if (!ok) {
        showToast('保存失败，无法打开打印预览', 'error');
        return;
      }
      window.open('/print.html', '_blank', 'noopener');
    });
  }

  function clearDragOver() {
    $$('.drag-over', contentPanel).forEach(function (el) {
      el.classList.remove('drag-over');
    });
  }

  function reorderSection(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    var sections = state.data.sections;
    var from = sections.findIndex(function (section) { return section.id === fromId; });
    var to = sections.findIndex(function (section) { return section.id === toId; });
    if (from < 0 || to < 0) return;
    var moved = sections.splice(from, 1)[0];
    var insertAt = sections.findIndex(function (section) { return section.id === toId; });
    sections.splice(insertAt < 0 ? sections.length : insertAt, 0, moved);
  }

  function reorderItem(sectionId, fromId, toId) {
    var section = findSection(sectionId);
    if (!section || !fromId || !toId || fromId === toId) return;
    var items = section.items;
    var from = items.findIndex(function (item) { return item.id === fromId; });
    var to = items.findIndex(function (item) { return item.id === toId; });
    if (from < 0 || to < 0) return;
    var moved = items.splice(from, 1)[0];
    var insertAt = items.findIndex(function (item) { return item.id === toId; });
    items.splice(insertAt < 0 ? items.length : insertAt, 0, moved);
  }

  function bindEvents() {
    contentPanel.addEventListener('input', onContentInput);
    contentPanel.addEventListener('change', onContentInput);
    contentPanel.addEventListener('click', onContentClick);
    contentPanel.addEventListener('toggle', function (event) {
      var card = event.target;
      if (!card.classList || !card.classList.contains('item-card')) return;
      if (card.open) state.collapsed.delete(card.dataset.itemId);
      else state.collapsed.add(card.dataset.itemId);
    }, true);

    contentPanel.addEventListener('click', function (event) {
      var addButton = event.target.closest('[data-add-section]');
      if (!addButton) return;
      addSection(addButton.dataset.addSection, addButton.dataset.title);
    });

    layoutPanel.addEventListener('input', onLayoutInput);
    layoutPanel.addEventListener('change', onLayoutChange);

    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        $$('.tab').forEach(function (item) { item.classList.remove('active'); });
        tab.classList.add('active');
        var name = tab.dataset.tab;
        contentPanel.hidden = name !== 'content';
        layoutPanel.hidden = name !== 'layout';
        if (name === 'layout') syncLayoutControls();
      });
    });

    moreBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      moreMenu.hidden = !moreMenu.hidden;
    });

    document.addEventListener('click', function (event) {
      if (!moreMenu.hidden && !moreMenu.contains(event.target) && event.target !== moreBtn) {
        moreMenu.hidden = true;
      }
    });

    moreMenu.addEventListener('click', function (event) {
      var button = event.target.closest('[data-action]');
      if (!button) return;
      var action = button.dataset.action;
      moreMenu.hidden = true;
      if (action === 'print') openPrint();
      else if (action === 'export-html') exportFile('html');
      else if (action === 'export-json') exportJson();
      else if (action === 'import-json') jsonInput.click();
      else if (action === 'reset-layout') resetLayout();
    });

    pdfBtn.addEventListener('click', function () { exportFile('pdf'); });
    wordBtn.addEventListener('click', function () { exportFile('docx'); });
    fitBtn.addEventListener('click', fitToPage);

    photoPicker.addEventListener('click', function () { photoInput.click(); });
    previewScroll.addEventListener('click', function (event) {
      if (event.target.closest('[data-photo-placeholder]')) photoInput.click();
    });
    photoInput.addEventListener('change', function () {
      uploadPhoto(photoInput.files && photoInput.files[0]);
      photoInput.value = '';
    });
    removePhotoBtn.addEventListener('click', function () {
      if (!state.data.profile.photo) return;
      state.data.profile.photo = '';
      renderPhoto();
      renderPreviewNow();
      markDirty();
      showToast('已移除照片');
    });
    jsonInput.addEventListener('change', function () {
      importJson(jsonInput.files && jsonInput.files[0]);
      jsonInput.value = '';
    });

    $('#loadExternalBtn').addEventListener('click', function () {
      reloadFromServer(true);
    });
    $('#dismissExternalBtn').addEventListener('click', function () {
      externalBanner.hidden = true;
      state.externalRevision = null;
      showToast('已保留当前编辑；下次保存会覆盖外部版本');
    });

    document.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveNow().then(function (ok) {
          if (ok) showToast('已保存', 'success');
        });
      }
    });

    window.addEventListener('beforeunload', function (event) {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });

    var dragStartHandler = function (event) {
      var sectionHandle = event.target.closest('[data-drag-section]');
      var itemHandle = event.target.closest('[data-drag-item]');
      if (sectionHandle) {
        state.drag = { type: 'section', id: sectionHandle.dataset.dragSection };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', state.drag.id);
      } else if (itemHandle) {
        var sectionCard = itemHandle.closest('[data-section-id]');
        state.drag = {
          type: 'item',
          sectionId: sectionCard && sectionCard.dataset.sectionId,
          id: itemHandle.dataset.dragItem
        };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', state.drag.id);
      }
    };

    var dragOverHandler = function (event) {
      if (!state.drag) return;
      var target = state.drag.type === 'section'
        ? event.target.closest('.section-card')
        : event.target.closest('.item-card');
      if (!target) return;
      if (state.drag.type === 'item') {
        var sectionCard = target.closest('[data-section-id]');
        if (!sectionCard || sectionCard.dataset.sectionId !== state.drag.sectionId) return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      clearDragOver();
      target.classList.add('drag-over');
    };

    var dropHandler = function (event) {
      if (!state.drag) return;
      var target = state.drag.type === 'section'
        ? event.target.closest('.section-card')
        : event.target.closest('.item-card');
      if (!target) return;
      event.preventDefault();
      if (state.drag.type === 'section') {
        reorderSection(state.drag.id, target.dataset.sectionId);
      } else {
        var sectionCard = target.closest('[data-section-id]');
        if (sectionCard && sectionCard.dataset.sectionId === state.drag.sectionId) {
          reorderItem(state.drag.sectionId, state.drag.id, target.dataset.itemId);
        }
      }
      state.drag = null;
      clearDragOver();
      renderSections();
      renderPreviewNow();
      markDirty();
    };

    contentPanel.addEventListener('dragstart', dragStartHandler);
    contentPanel.addEventListener('dragover', dragOverHandler);
    contentPanel.addEventListener('drop', dropHandler);
    contentPanel.addEventListener('dragend', function () {
      state.drag = null;
      clearDragOver();
    });

    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        updatePreviewScale();
      }).observe(previewScroll);
    }
    window.addEventListener('resize', updatePreviewScale);

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        updatePreviewScale();
      });
    }
  }

  init();
})();
