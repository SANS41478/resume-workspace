# -*- coding: utf-8 -*-
"""Generate a clean, editable Word version from resume.json."""

import argparse
import json
import os
import re
import sys

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm, Pt, RGBColor

ROOT = os.path.dirname(os.path.abspath(__file__))
FONT = "Microsoft YaHei"
TEXT = "111827"
MUTED = "6B7280"
SOFT = "374151"
LINE = "E5E7EB"


def clamp(value, default, low, high):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return min(high, max(low, number))


def normalize_hex(value):
    match = re.fullmatch(r"#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})", str(value or "").strip())
    if not match:
        return "1D4ED8"
    color = match.group(1)
    if len(color) == 3:
        color = "".join(ch * 2 for ch in color)
    return color.upper()


def set_run_font(run, size=None, bold=None, color=None, font=FONT):
    run.font.name = font
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:ascii"), font)
    rfonts.set(qn("w:hAnsi"), font)
    rfonts.set(qn("w:eastAsia"), font)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def add_run(paragraph, text, size=None, bold=None, color=None):
    run = paragraph.add_run(str(text))
    set_run_font(run, size=size, bold=bold, color=color)
    return run


def set_bottom_border(paragraph, color=LINE, size=6, space=1):
    ppr = paragraph._p.get_or_add_pPr()
    pbdr = ppr.find(qn("w:pBdr"))
    if pbdr is None:
        pbdr = OxmlElement("w:pBdr")
        ppr.append(pbdr)
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), str(size))
    bottom.set(qn("w:space"), str(space))
    bottom.set(qn("w:color"), color)
    pbdr.append(bottom)


def remove_table_borders(table):
    tblpr = table._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        element = OxmlElement("w:" + edge)
        element.set(qn("w:val"), "nil")
        borders.append(element)
    tblpr.append(borders)

    cell_mar = OxmlElement("w:tblCellMar")
    for side in ("top", "left", "bottom", "right"):
        element = OxmlElement("w:" + side)
        element.set(qn("w:w"), "0")
        element.set(qn("w:type"), "dxa")
        cell_mar.append(element)
    tblpr.append(cell_mar)


def has(value):
    return bool(str(value or "").strip())


def date_range(item):
    start = str(item.get("start") or "").strip()
    end = str(item.get("end") or "").strip()
    if start and end:
        return start + " – " + end
    return start or end


def item_has_content(item):
    if any(has(item.get(key)) for key in ("title", "subtitle", "description", "meta", "link", "start", "end")):
        return True
    if any(has(line) for line in item.get("bullets") or []):
        return True
    if any(has(tag) for tag in item.get("tags") or []):
        return True
    return False


def content_width_mm(layout):
    margin = clamp(layout.get("pageMargin"), 14, 8, 20)
    return 210 - margin * 2


def add_header_content(container, profile, layout, accent, base_size, first_paragraph=None):
    paragraphs = []

    def new_para():
        if first_paragraph is not None and not paragraphs:
            paragraph = first_paragraph
        else:
            paragraph = container.add_paragraph()
        paragraphs.append(paragraph)
        return paragraph

    name = str(profile.get("name") or "").strip()
    title = str(profile.get("title") or "").strip()
    phone = str(profile.get("phone") or "").strip()
    email = str(profile.get("email") or "").strip()
    location = str(profile.get("location") or "").strip()
    summary = str(profile.get("summary") or "").strip()

    if name:
        p = new_para()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.line_spacing = 1.05
        add_run(p, name, size=min(26, base_size * 2.15), bold=True, color=TEXT)

    if title:
        p = new_para()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(3)
        add_run(p, title, size=base_size * 1.06, bold=True, color=accent)

    contact_parts = []
    if phone:
        contact_parts.append(phone)
    if email:
        contact_parts.append(email)
    if location:
        contact_parts.append(location)
    for link in profile.get("links") or []:
        if not isinstance(link, dict):
            continue
        label = str(link.get("label") or "").strip()
        url = str(link.get("url") or "").strip()
        if not url:
            continue
        contact_parts.append((label + " " + url).strip())

    if contact_parts:
        p = new_para()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(4)
        add_run(p, " ｜ ".join(contact_parts), size=base_size * 0.9, color=MUTED)

    if summary:
        p = new_para()
        p.paragraph_format.space_before = Pt(2)
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.line_spacing = 1.6
        add_run(p, summary, size=base_size * 0.95, color=SOFT)

    return paragraphs


def add_divider(doc):
    divider = doc.add_paragraph()
    divider.paragraph_format.space_before = Pt(4)
    divider.paragraph_format.space_after = Pt(2)
    divider.paragraph_format.line_spacing = Pt(1)
    set_bottom_border(divider, LINE, 6, 1)
    add_run(divider, "", size=1)
    return divider


def add_section_heading(doc, title, accent, base_size, gap, style):
    heading = doc.add_paragraph()
    heading.paragraph_format.space_before = Pt(max(6, gap * 0.7))
    heading.paragraph_format.space_after = Pt(3)
    heading.paragraph_format.keep_with_next = True

    if style == "line":
        add_run(heading, "■  ", size=base_size * 0.85, bold=True, color=accent)
    add_run(heading, title, size=base_size + 1.2, bold=True, color=TEXT)
    if style == "underline":
        set_bottom_border(heading, LINE, 6, 2)
    return heading


def add_right_tab(paragraph, width_mm):
    paragraph.paragraph_format.tab_stops.add_tab_stop(Mm(width_mm), WD_TAB_ALIGNMENT.RIGHT)


def add_standard_item(doc, section, item, layout, accent, base_size, content_width):
    paragraphs = []

    title = str(item.get("title") or "").strip()
    subtitle = str(item.get("subtitle") or "").strip()
    meta = str(item.get("meta") or "").strip()
    description = str(item.get("description") or "").strip()
    bullets = [str(line).strip() for line in item.get("bullets") or [] if has(line)]
    tags = [str(tag).strip() for tag in item.get("tags") or [] if has(tag)]
    date = date_range(item)

    if title or date:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(2)
        p.paragraph_format.space_after = Pt(1)
        p.paragraph_format.keep_with_next = True
        add_right_tab(p, content_width)
        if title:
            add_run(p, title, size=base_size * 1.02, bold=True, color=TEXT)
        if date:
            add_run(p, "\t", size=base_size)
            add_run(p, date, size=base_size * 0.86, bold=True, color=accent)
        paragraphs.append(p)

    if subtitle or meta:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(1)
        add_right_tab(p, content_width)
        if subtitle:
            add_run(p, subtitle, size=base_size * 0.93, color=SOFT)
        if meta:
            add_run(p, "\t" + meta, size=base_size * 0.9, color=MUTED)
        paragraphs.append(p)

    if description:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.space_after = Pt(1)
        p.paragraph_format.line_spacing = 1.55
        add_run(p, description, size=base_size, color=SOFT)
        paragraphs.append(p)

    for line in bullets:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(1)
        p.paragraph_format.line_spacing = 1.5
        p.paragraph_format.left_indent = Mm(4.2)
        p.paragraph_format.first_line_indent = Mm(-3.2)
        p.paragraph_format.keep_together = True
        add_run(p, "•  ", size=base_size, bold=True, color=accent)
        add_run(p, line, size=base_size, color=SOFT)
        paragraphs.append(p)

    if tags:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.space_after = Pt(0)
        label = "技术栈：" if any(word in section.get("title", "") for word in ("项目", "工作", "经历")) else ""
        add_run(p, label + "、".join(tags), size=base_size * 0.85, color=MUTED)
        paragraphs.append(p)

    if paragraphs:
        paragraphs[-1].paragraph_format.space_after = Pt(5)


def add_tags_item(doc, item, accent, base_size):
    paragraphs = []
    title = str(item.get("title") or "").strip()
    description = str(item.get("description") or "").strip()
    tags = [str(tag).strip() for tag in item.get("tags") or [] if has(tag)]
    bullets = [str(line).strip() for line in item.get("bullets") or [] if has(line)]

    if title:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(2)
        p.paragraph_format.space_after = Pt(1)
        add_run(p, title, size=base_size * 0.95, bold=True, color=TEXT)
        paragraphs.append(p)

    if tags:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.line_spacing = 1.45
        add_run(p, "、".join(tags), size=base_size * 0.9, color=SOFT)
        paragraphs.append(p)

    if description:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.space_after = Pt(2)
        add_run(p, description, size=base_size * 0.9, color=SOFT)
        paragraphs.append(p)

    for line in bullets:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(1)
        p.paragraph_format.left_indent = Mm(4.2)
        p.paragraph_format.first_line_indent = Mm(-3.2)
        add_run(p, "•  ", size=base_size, bold=True, color=accent)
        add_run(p, line, size=base_size, color=SOFT)
        paragraphs.append(p)

    if paragraphs:
        paragraphs[-1].paragraph_format.space_after = Pt(4)


def build(data, output_path):
    profile = data.get("profile") or {}
    layout = data.get("layout") or {}
    sections = [section for section in data.get("sections") or [] if section and section.get("visible", True) is not False]

    base_size = clamp(layout.get("fontSize"), 10, 9, 13)
    line_height = clamp(layout.get("lineHeight"), 1.45, 1.3, 1.9)
    gap = clamp(layout.get("sectionGap"), 11, 6, 24)
    margin = clamp(layout.get("pageMargin"), 12, 8, 20)
    accent = normalize_hex(layout.get("accent"))
    photo_width = clamp(layout.get("photoWidth"), 25, 18, 35)
    title_style = layout.get("titleStyle") if layout.get("titleStyle") in ("line", "underline", "plain") else "line"
    show_photo = layout.get("showPhoto", True) is not False

    content_width = content_width_mm(layout)

    doc = Document()
    section = doc.sections[0]
    section.page_width = Mm(210)
    section.page_height = Mm(297)
    section.top_margin = Mm(margin)
    section.bottom_margin = Mm(margin)
    section.left_margin = Mm(margin)
    section.right_margin = Mm(margin)

    normal = doc.styles["Normal"]
    normal.font.name = FONT
    normal.font.size = Pt(base_size)
    normal.paragraph_format.space_after = Pt(0)
    normal.paragraph_format.line_spacing = line_height
    rpr = normal.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), FONT)
    rfonts.set(qn("w:ascii"), FONT)
    rfonts.set(qn("w:hAnsi"), FONT)

    photo = str(profile.get("photo") or "").split("?")[0].strip()
    photo_path = ""
    if photo:
        candidate = photo if os.path.isabs(photo) else os.path.join(ROOT, photo.replace("/", os.sep))
        if os.path.isfile(candidate):
            photo_path = candidate

    if show_photo and photo_path:
        table = doc.add_table(rows=1, cols=2)
        table.autofit = False
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        remove_table_borders(table)
        left_cell, right_cell = table.rows[0].cells
        left_cell.width = Mm(content_width * 0.72)
        right_cell.width = Mm(content_width * 0.28)

        add_header_content(left_cell, profile, layout, accent, base_size, left_cell.paragraphs[0])

        photo_paragraph = right_cell.paragraphs[0]
        photo_paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        photo_paragraph.paragraph_format.space_before = Pt(0)
        photo_paragraph.paragraph_format.space_after = Pt(0)
        try:
            run = photo_paragraph.add_run()
            run.add_picture(photo_path, width=Mm(photo_width))
        except Exception:
            pass
    else:
        add_header_content(doc, profile, layout, accent, base_size)

    add_divider(doc)

    for section_data in sections:
        items = [item for item in section_data.get("items") or [] if isinstance(item, dict) and item_has_content(item)]
        if not items:
            continue

        add_section_heading(doc, str(section_data.get("title") or "未命名模块"), accent, base_size, gap, title_style)
        if section_data.get("type") == "tags":
            for item in items:
                add_tags_item(doc, item, accent, base_size)
        else:
            for item in items:
                add_standard_item(doc, section_data, item, layout, accent, base_size, content_width)

    doc.core_properties.title = (str(profile.get("name") or "") + " - 简历").strip()
    doc.core_properties.author = str(profile.get("name") or "").strip()

    output_dir = os.path.dirname(os.path.abspath(output_path))
    os.makedirs(output_dir, exist_ok=True)
    doc.save(output_path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", help="output .docx path")
    args = parser.parse_args()

    with open(os.path.join(ROOT, "resume.json"), "r", encoding="utf-8") as handle:
        data = json.load(handle)

    profile = data.get("profile") or {}
    parts = [str(profile.get("name") or "").strip(), str(profile.get("title") or "").strip(), "简历"]
    base = "-".join([part for part in parts if part])
    base = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", base).replace(" ", "")[:80] or "简历"

    output_path = args.out or os.path.join(ROOT, "输出", base + ".docx")
    build(data, output_path)
    print(output_path)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("ERROR: " + str(exc), file=sys.stderr)
        sys.exit(1)
