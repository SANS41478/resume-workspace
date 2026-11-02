(function (global) {
  'use strict';

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ESC[ch];
    });
  }

  function trim(value) {
    return String(value == null ? '' : value).trim();
  }

  function has(value) {
    return trim(value).length > 0;
  }

  function safeUrl(value) {
    var url = trim(value);
    if (!url) return '';
    if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
    if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(url)) return 'https://' + url;
    return '';
  }

  function safePhoto(value) {
    var src = trim(value);
    if (!src) return '';
    if (/^data:image\//i.test(src)) return src;
    if (/^(assets\/|\.\/assets\/|\/assets\/|https?:\/\/)/i.test(src)) return src;
    return '';
  }

  function dateRange(item) {
    var start = trim(item.start);
    var end = trim(item.end);
    if (start && end) return start + ' – ' + end;
    return start || end;
  }

  function itemHasContent(item) {
    if (!item) return false;
    var fields = ['title', 'subtitle', 'description', 'meta', 'link', 'start', 'end'];
    for (var i = 0; i < fields.length; i += 1) {
      if (has(item[fields[i]])) return true;
    }
    if (Array.isArray(item.bullets) && item.bullets.some(has)) return true;
    if (Array.isArray(item.tags) && item.tags.some(has)) return true;
    return false;
  }

  function kebab(key) {
    return String(key).replace(/[A-Z]/g, function (ch) {
      return '-' + ch.toLowerCase();
    });
  }

  function editAttrs(options, kind, data) {
    if (!options.editor) return '';
    var html = ' data-edit-kind="' + esc(kind) + '"';
    Object.keys(data || {}).forEach(function (key) {
      var value = data[key];
      if (value === undefined || value === null) return;
      html += ' data-' + kebab(key) + '="' + esc(value) + '"';
    });
    return html;
  }

  function editableText(options, tagName, className, text, kind, data, placeholder, extraAttrs) {
    var classes = className + (options.editor ? ' editable' : '');
    var attrs = editAttrs(options, kind, data);
    var ph = options.editor ? ' data-placeholder="' + esc(placeholder || '') + '"' : '';
    return '<' + tagName + ' class="' + classes + '"' + attrs + ph + (extraAttrs || '') + '>' + esc(text) + '</' + tagName + '>';
  }

  function renderTags(tags, section, item, options) {
    var list = (tags || []).map(trim);
    if (!options.editor) {
      var visible = list.filter(Boolean);
      if (!visible.length) return '';
      return '<div class="tags">' + visible.map(function (tag) {
        return '<span class="tag">' + esc(tag) + '</span>';
      }).join('') + '</div>';
    }

    var html = '<div class="tags">';
    list.forEach(function (tag, index) {
      html += '<span class="tag-wrap">' +
        editableText(options, 'span', 'tag', tag, 'tag', {
          sectionId: section.id,
          itemId: item.id,
          index: index
        }, '标签') +
        '<button type="button" class="tag-remove no-edit" data-preview-action="remove-tag" data-section-id="' + esc(section.id) + '" data-item-id="' + esc(item.id) + '" data-index="' + index + '" title="删除标签">×</button>' +
        '</span>';
    });
    html += '<button type="button" class="tag-add no-edit" data-preview-action="add-tag" data-section-id="' + esc(section.id) + '" data-item-id="' + esc(item.id) + '" title="添加标签">＋</button>';
    html += '</div>';
    return html;
  }

  function renderBullets(bullets, section, item, options, withAdd) {
    var list = (bullets || []).map(trim);
    if (!options.editor) {
      var visible = list.filter(Boolean);
      if (!visible.length) return '';
      return '<ul class="bullets">' + visible.map(function (line) {
        return '<li>' + esc(line) + '</li>';
      }).join('') + '</ul>';
    }

    var html = '';
    if (list.length) {
      html += '<ul class="bullets">';
      list.forEach(function (line, index) {
        html += '<li class="editable-bullet"' + editAttrs(options, 'bullet', {
          sectionId: section.id,
          itemId: item.id,
          index: index
        }) + ' data-placeholder="输入要点">' + esc(line) + '</li>';
      });
      html += '</ul>';
    }
    if (withAdd !== false) {
      html += '<button type="button" class="inline-add no-edit" data-preview-action="add-bullet" data-section-id="' + esc(section.id) + '" data-item-id="' + esc(item.id) + '">＋ 要点</button>';
    }
    return html;
  }

  function renderDate(item, section, options) {
    var start = trim(item.start);
    var end = trim(item.end);
    if (!options.editor) {
      if (!start && !end) return '';
      return '<span class="item-date">' + esc(dateRange(item)) + '</span>';
    }
    return '<span class="item-date editable-date">' +
      editableText(options, 'span', 'date-part', start, 'item', {
        sectionId: section.id,
        itemId: item.id,
        field: 'start'
      }, '开始') +
      '<span class="date-sep"> – </span>' +
      editableText(options, 'span', 'date-part', end, 'item', {
        sectionId: section.id,
        itemId: item.id,
        field: 'end'
      }, '结束') +
      '</span>';
  }

  function renderSectionTools(section, layout, options) {
    if (!options.editor) return '';
    var columnButton = Number(layout.columns) === 2
      ? '<button type="button" class="preview-tool" data-preview-action="toggle-column" data-section-id="' + esc(section.id) + '" title="切换主栏/侧栏">' + (section.column === 'side' ? '主栏' : '侧栏') + '</button>'
      : '';
    return '<div class="section-tools no-edit">' +
      '<span class="preview-drag-handle" draggable="true" data-drag-preview-section="' + esc(section.id) + '" title="拖拽模块">⠿</span>' +
      '<button type="button" class="preview-tool" data-preview-action="add-item" data-section-id="' + esc(section.id) + '" title="添加条目">＋ 条目</button>' +
      columnButton +
      '<button type="button" class="preview-tool" data-preview-action="toggle-visible" data-section-id="' + esc(section.id) + '" title="隐藏模块">隐藏</button>' +
      '<button type="button" class="preview-tool danger" data-preview-action="delete-section" data-section-id="' + esc(section.id) + '" title="删除模块">×</button>' +
      '</div>';
  }

  function renderItemTools(section, item, options) {
    if (!options.editor) return '';
    return '<div class="item-tools no-edit">' +
      '<span class="preview-drag-handle" draggable="true" data-drag-preview-item="' + esc(item.id) + '" data-section-id="' + esc(section.id) + '" title="拖拽条目">⠿</span>' +
      '<button type="button" class="preview-tool" data-preview-action="edit-item-link" data-section-id="' + esc(section.id) + '" data-item-id="' + esc(item.id) + '" title="编辑链接">链接</button>' +
      '<button type="button" class="preview-tool danger" data-preview-action="delete-item" data-section-id="' + esc(section.id) + '" data-item-id="' + esc(item.id) + '" title="删除条目">×</button>' +
      '</div>';
  }

  function renderContact(profile, options) {
    var parts = [];
    var phone = trim(profile.phone);
    var email = trim(profile.email);
    var location = trim(profile.location);

    if (options.editor) {
      parts.push(editableText(options, phone ? 'a' : 'span', 'contact-item', phone, 'profile', {
        field: 'phone'
      }, '手机', phone ? ' href="tel:' + esc(phone.replace(/[^\d+]/g, '')) + '"' : ''));
      parts.push(editableText(options, email ? 'a' : 'span', 'contact-item', email, 'profile', {
        field: 'email'
      }, '邮箱', email ? ' href="mailto:' + esc(email) + '"' : ''));
      parts.push(editableText(options, 'span', 'contact-item', location, 'profile', {
        field: 'location'
      }, '城市'));
    } else {
      if (phone) {
        parts.push('<a class="contact-item" href="tel:' + esc(phone.replace(/[^\d+]/g, '')) + '">' + esc(profile.phone) + '</a>');
      }
      if (email) {
        parts.push('<a class="contact-item" href="mailto:' + esc(email) + '">' + esc(profile.email) + '</a>');
      }
      if (location) {
        parts.push('<span class="contact-item">' + esc(profile.location) + '</span>');
      }
    }

    (profile.links || []).forEach(function (link, index) {
      var url = safeUrl(link && link.url);
      if (!url) return;
      var label = has(link.label) ? trim(link.label) : url.replace(/^https?:\/\//i, '');
      if (options.editor) {
        parts.push('<span class="contact-link-wrap">' +
          editableText(options, 'a', 'contact-item', label, 'profile-link', {
            linkIndex: index,
            field: 'label'
          }, '链接文字', ' href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"') +
          '<button type="button" class="contact-link-edit no-edit" data-preview-action="edit-profile-link" data-link-index="' + index + '" title="编辑链接地址">↗</button>' +
          '</span>');
      } else {
        parts.push('<a class="contact-item" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>');
      }
    });

    if (options.editor) {
      parts.push('<button type="button" class="contact-add no-edit" data-preview-action="add-profile-link" title="添加链接">＋链接</button>');
    }

    if (!parts.length) return '';
    return '<div class="contact">' + parts.join('') + '</div>';
  }

  function renderHeader(profile, layout, options) {
    var showPhoto = layout.showPhoto !== false;
    var photoSrc = safePhoto(profile.photo);
    var photoHTML = '';

    if (showPhoto && (photoSrc || options.editor)) {
      var photoClasses = 'photo photo-' + esc(layout.photoShape || 'rounded') +
        (photoSrc ? '' : ' is-placeholder') +
        (options.editor ? ' editable-photo' : '');
      var photoInner = photoSrc
        ? '<img src="' + esc(photoSrc) + '" alt="">'
        : '<span class="photo-placeholder-text">照片</span>';
      if (options.editor) {
        photoInner += '<span class="photo-replace-hint no-edit">' + (photoSrc ? '更换照片' : '上传照片') + '</span>';
        if (photoSrc) {
          photoInner += '<button type="button" class="photo-remove no-edit" data-preview-action="remove-photo" title="移除照片">×</button>';
        }
      }
      photoHTML = '<div class="' + photoClasses + '"' + (options.editor ? ' data-photo-edit="1"' : '') + '>' +
        photoInner +
        '</div>';
    }

    var contact = renderContact(profile, options);
    var nameHTML = (has(profile.name) || options.editor)
      ? editableText(options, 'h1', 'name', profile.name, 'profile', { field: 'name' }, '姓名')
      : '';
    var titleHTML = (has(profile.title) || options.editor)
      ? editableText(options, 'div', 'headline', profile.title, 'profile', { field: 'title' }, '求职岗位')
      : '';
    var summaryHTML = (has(profile.summary) || options.editor)
      ? editableText(options, 'p', 'summary', profile.summary, 'profile', { field: 'summary' }, '个人简介')
      : '';

    return '<header class="resume-header header-' + esc(layout.headerAlign || 'left') + ' photo-' + esc(layout.photoPosition || 'right') + '">' +
      '<div class="header-text">' + nameHTML + titleHTML + contact + summaryHTML + '</div>' +
      photoHTML +
      '</header>';
  }

  function renderStandardItem(section, item, options) {
    var link = safeUrl(item.link);
    var range = renderDate(item, section, options);
    var titleText = trim(item.title);
    var subtitle = trim(item.subtitle);
    var meta = trim(item.meta);
    var desc = trim(item.description);

    var titleHTML = '';
    if (has(titleText) || options.editor) {
      var titleData = { sectionId: section.id, itemId: item.id, field: 'title' };
      if (link) {
        titleHTML = editableText(options, 'a', 'item-title', titleText, 'item', titleData, '主标题',
          ' href="' + esc(link) + '" target="_blank" rel="noopener noreferrer"');
      } else {
        titleHTML = editableText(options, 'span', 'item-title', titleText, 'item', titleData, '主标题');
      }
    }

    var heading = '';
    if (titleHTML || range) {
      heading = '<div class="item-line">' +
        '<span class="item-title-wrap">' + titleHTML + '</span>' +
        range +
        '</div>';
    }

    var subHTML = '';
    if (has(subtitle) || has(meta)) {
      subHTML = '<div class="item-sub">' +
        (has(subtitle)
          ? editableText(options, 'span', 'item-subtitle', subtitle, 'item', {
            sectionId: section.id,
            itemId: item.id,
            field: 'subtitle'
          }, '副标题')
          : '') +
        (has(meta)
          ? editableText(options, 'span', 'item-meta', meta, 'item', {
            sectionId: section.id,
            itemId: item.id,
            field: 'meta'
          }, '地点 / 备注')
          : '') +
        '</div>';
    }

    var descHTML = has(desc)
      ? editableText(options, 'p', 'item-desc', desc, 'item', {
        sectionId: section.id,
        itemId: item.id,
        field: 'description'
      }, '添加描述')
      : '';

    return '<article class="item" data-section-id="' + esc(section.id) + '" data-item-id="' + esc(item.id) + '">' +
      renderItemTools(section, item, options) +
      heading +
      subHTML +
      descHTML +
      renderBullets(item.bullets, section, item, options) +
      renderTags(item.tags, section, item, options) +
      '</article>';
  }

  function renderTagItem(section, item, options) {
    var title = (has(item.title) || options.editor)
      ? editableText(options, 'div', 'skill-group-title', item.title, 'item', {
        sectionId: section.id,
        itemId: item.id,
        field: 'title'
      }, '分组名称')
      : '';
    var desc = has(item.description)
      ? editableText(options, 'p', 'item-desc', item.description, 'item', {
        sectionId: section.id,
        itemId: item.id,
        field: 'description'
      }, '补充说明')
      : '';

    return '<article class="skill-item" data-section-id="' + esc(section.id) + '" data-item-id="' + esc(item.id) + '">' +
      renderItemTools(section, item, options) +
      title +
      desc +
      renderTags(item.tags, section, item, options) +
      renderBullets(item.bullets, section, item, options, false) +
      '</article>';
  }

  function renderSection(section, layout, options) {
    if (!section || section.visible === false) return '';
    var type = section.type || 'timeline';
    var sourceItems = section.items || [];
    var items = options.editor ? sourceItems : sourceItems.filter(itemHasContent);
    if (!items.length && !options.editor) return '';

    var body = items.length
      ? items.map(function (item) {
        return type === 'tags' ? renderTagItem(section, item, options) : renderStandardItem(section, item, options);
      }).join('')
      : '<div class="empty-hint">暂无内容，可点上方「＋ 条目」添加</div>';

    var title = editableText(options, 'span', 'section-title-text', section.title || (options.editor ? '' : '未命名模块'), 'section', {
      sectionId: section.id,
      field: 'title'
    }, '模块名称');

    return '<section class="section section-' + esc(type) + '" data-section="' + esc(section.id) + '">' +
      renderSectionTools(section, layout, options) +
      '<h2 class="section-title">' + title + '</h2>' +
      '<div class="section-body">' + body + '</div>' +
      '</section>';
  }

  function number(value, fallback, min, max) {
    var num = Number(value);
    if (!isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
  }

  function render(root, data, options) {
    options = options || {};
    data = data || {};
    var profile = data.profile || {};
    var layout = data.layout || {};
    var sections = (data.sections || []).filter(function (section) {
      return section && section.visible !== false;
    });

    var stylePreset = ['classic', 'swiss-ikb', 'swiss-red', 'swiss-mono'].indexOf(layout.stylePreset) >= 0
      ? layout.stylePreset
      : 'classic';
    root.className = 'resume-page style-' + stylePreset +
      (stylePreset.indexOf('swiss') === 0 ? ' style-swiss' : '') +
      (options.editor ? ' editor-mode' : '') +
      ' font-' + (layout.fontFamily === 'serif' ? 'serif' : 'sans') +
      ' titles-' + (layout.titleStyle || 'line') +
      ' tags-' + (layout.tagStyle || 'soft') +
      ' columns-' + (Number(layout.columns) === 2 ? '2' : '1');
    root.style.setProperty('--accent', /^#[0-9a-f]{3,8}$/i.test(layout.accent || '') ? layout.accent : '#1d4ed8');
    root.style.setProperty('--fs', number(layout.fontSize, 10.5, 8, 14) + 'pt');
    root.style.setProperty('--lh', String(number(layout.lineHeight, 1.55, 1.2, 2.1)));
    root.style.setProperty('--gap', number(layout.sectionGap, 14, 4, 30) + 'pt');
    root.style.setProperty('--margin', number(layout.pageMargin, 14, 6, 24) + 'mm');
    root.style.setProperty('--photo-w', number(layout.photoWidth, 25, 16, 40) + 'mm');
    root.style.setProperty('--photo-h', number(layout.photoHeight, 32, 20, 50) + 'mm');
    root.style.setProperty('--side-w', number(layout.sideWidth, 33, 22, 48) + '%');

    var header = renderHeader(profile, layout, options);
    var html = '';
    var addSectionHTML = options.editor
      ? '<button type="button" class="preview-add-section no-edit" data-preview-action="add-section">＋ 添加模块</button>'
      : '';

    if (Number(layout.columns) === 2) {
      var mainSections = sections.filter(function (section) { return section.column !== 'side'; });
      var sideSections = sections.filter(function (section) { return section.column === 'side'; });

      if (!sideSections.length && !options.editor) {
        html = '<div class="col-main col-main-full">' + mainSections.map(function (section) {
          return renderSection(section, layout, options);
        }).join('') + '</div>';
      } else {
        var mainHTML = mainSections.map(function (section) {
          return renderSection(section, layout, options);
        }).join('');
        var sideHTML = sideSections.map(function (section) {
          return renderSection(section, layout, options);
        }).join('');
        if (options.editor) {
          mainHTML += '<div class="column-drop-zone no-edit" data-drop-column="main">拖到主栏</div>';
          sideHTML += '<div class="column-drop-zone no-edit" data-drop-column="side">拖到侧栏</div>';
          mainHTML += addSectionHTML;
        }
        html = '<div class="resume-columns">' +
          '<div class="col-main">' + mainHTML + '</div>' +
          '<aside class="col-side">' +
          (sideHTML || '<div class="empty-hint side-hint">在左侧把模块设为「侧栏」后会显示在这里</div>') +
          '</aside>' +
          '</div>';
      }
    } else {
      var singleHTML = sections.map(function (section) {
        return renderSection(section, layout, options);
      }).join('');
      if (options.editor) singleHTML += addSectionHTML;
      html = '<div class="col-main col-main-full">' + singleHTML + '</div>';
    }

    root.innerHTML = header + html;
    return root;
  }

  global.ResumeRenderer = { render: render };
})(window);
