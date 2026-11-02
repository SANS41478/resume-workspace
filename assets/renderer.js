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

  function renderTags(tags) {
    var list = (tags || []).map(trim).filter(Boolean);
    if (!list.length) return '';
    return '<div class="tags">' + list.map(function (tag) {
      return '<span class="tag">' + esc(tag) + '</span>';
    }).join('') + '</div>';
  }

  function renderBullets(bullets) {
    var list = (bullets || []).map(trim).filter(Boolean);
    if (!list.length) return '';
    return '<ul class="bullets">' + list.map(function (line) {
      return '<li>' + esc(line) + '</li>';
    }).join('') + '</ul>';
  }

  function renderContact(profile) {
    var parts = [];
    if (has(profile.phone)) {
      var tel = trim(profile.phone).replace(/[^\d+]/g, '');
      parts.push('<a class="contact-item" href="tel:' + esc(tel) + '">' + esc(profile.phone) + '</a>');
    }
    if (has(profile.email)) {
      parts.push('<a class="contact-item" href="mailto:' + esc(trim(profile.email)) + '">' + esc(profile.email) + '</a>');
    }
    if (has(profile.location)) {
      parts.push('<span class="contact-item">' + esc(profile.location) + '</span>');
    }
    (profile.links || []).forEach(function (link) {
      var url = safeUrl(link && link.url);
      if (!url) return;
      var label = has(link.label) ? trim(link.label) : url.replace(/^https?:\/\//i, '');
      parts.push('<a class="contact-item" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>');
    });
    if (!parts.length) return '';
    return '<div class="contact">' + parts.join('') + '</div>';
  }

  function renderHeader(profile, layout, options) {
    var showPhoto = layout.showPhoto !== false;
    var photoSrc = safePhoto(profile.photo);
    var photoHTML = '';
    if (showPhoto) {
      if (photoSrc) {
        photoHTML = '<div class="photo photo-' + esc(layout.photoShape || 'rounded') + '"><img src="' + esc(photoSrc) + '" alt=""></div>';
      } else if (options.editor) {
        photoHTML = '<div class="photo photo-' + esc(layout.photoShape || 'rounded') + ' is-placeholder" data-photo-placeholder="1"><span>照片</span></div>';
      }
    }

    var contact = renderContact(profile);
    var text = '' +
      (has(profile.name) ? '<h1 class="name">' + esc(profile.name) + '</h1>' : '') +
      (has(profile.title) ? '<div class="headline">' + esc(profile.title) + '</div>' : '') +
      contact +
      (has(profile.summary) ? '<p class="summary">' + esc(profile.summary) + '</p>' : '');

    return '<header class="resume-header header-' + esc(layout.headerAlign || 'left') + ' photo-' + esc(layout.photoPosition || 'right') + '">' +
      '<div class="header-text">' + text + '</div>' +
      photoHTML +
      '</header>';
  }

  function renderStandardItem(item) {
    var range = dateRange(item);
    var link = safeUrl(item.link);
    var subtitle = trim(item.subtitle);
    var meta = trim(item.meta);
    var desc = trim(item.description);

    var title = has(item.title)
      ? (link
        ? '<a class="item-title" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">' + esc(item.title) + '</a>'
        : '<span class="item-title">' + esc(item.title) + '</span>')
      : '';

    var heading = '<div class="item-line">' +
      '<span class="item-title-wrap">' + title + '</span>' +
      (range ? '<span class="item-date">' + esc(range) + '</span>' : '') +
      '</div>';

    if (subtitle || meta) {
      heading += '<div class="item-sub">' +
        (subtitle ? '<span class="item-subtitle">' + esc(subtitle) + '</span>' : '') +
        (meta ? '<span class="item-meta">' + esc(meta) + '</span>' : '') +
        '</div>';
    }

    return '<article class="item">' +
      heading +
      (desc ? '<p class="item-desc">' + esc(desc) + '</p>' : '') +
      renderBullets(item.bullets) +
      renderTags(item.tags) +
      '</article>';
  }

  function renderTagItem(item) {
    var title = has(item.title) ? '<div class="skill-group-title">' + esc(item.title) + '</div>' : '';
    var desc = has(item.description) ? '<p class="item-desc">' + esc(item.description) + '</p>' : '';
    return '<article class="skill-item">' + title + desc + renderTags(item.tags) + renderBullets(item.bullets) + '</article>';
  }

  function renderSection(section, options) {
    if (!section || section.visible === false) return '';
    var type = section.type || 'timeline';
    var items = (section.items || []).filter(itemHasContent);
    if (!items.length && !options.editor) return '';

    var body = items.length
      ? items.map(function (item) {
        return type === 'tags' ? renderTagItem(item) : renderStandardItem(item, type);
      }).join('')
      : '<div class="empty-hint">暂无内容，可在左侧添加条目</div>';

    return '<section class="section section-' + esc(type) + '" data-section="' + esc(section.id) + '">' +
      '<h2 class="section-title"><span>' + esc(section.title || '未命名模块') + '</span></h2>' +
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

    root.className = 'resume-page font-' + (layout.fontFamily === 'serif' ? 'serif' : 'sans') +
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

    if (Number(layout.columns) === 2) {
      var mainSections = sections.filter(function (section) { return section.column !== 'side'; });
      var sideSections = sections.filter(function (section) { return section.column === 'side'; });

      if (!sideSections.length && !options.editor) {
        html = '<div class="col-main col-main-full">' + mainSections.map(function (section) {
          return renderSection(section, options);
        }).join('') + '</div>';
      } else {
        html = '<div class="resume-columns">' +
          '<div class="col-main">' + mainSections.map(function (section) {
            return renderSection(section, options);
          }).join('') + '</div>' +
          '<aside class="col-side">' +
          (sideSections.length
            ? sideSections.map(function (section) { return renderSection(section, options); }).join('')
            : '<div class="empty-hint side-hint">在左侧把模块设为「侧栏」后会显示在这里</div>') +
          '</aside>' +
          '</div>';
      }
    } else {
      html = '<div class="col-main col-main-full">' + sections.map(function (section) {
        return renderSection(section, options);
      }).join('') + '</div>';
    }

    root.innerHTML = header + html;
    return root;
  }

  global.ResumeRenderer = { render: render };
})(window);
