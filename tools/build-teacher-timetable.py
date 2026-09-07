# -*- coding: utf-8 -*-
"""교사시간표 엑셀 → teacher-timetable.js 변환.

학교에서 새 "교사시간표(m.dd).xlsx"를 받으면 이 스크립트만 다시 돌리면 된다.

    python tools/build-teacher-timetable.py "교사시간표(8.19).xlsx" [--semester "2026학년도 2학기"]

엑셀 구조 전제: '교사시간표' 시트에 [이름 | 월 화 수 목 금] 머리행 + 7개 교시행 +
빈 행이 교사 수만큼 반복된다. 셀 값은 "반\n과목" (예: 104\n국어A).
"""
import argparse
import io
import json
import os
import re

import openpyxl


def parse(path, sheet_name='교사시간표'):
    book = openpyxl.load_workbook(path, data_only=True)
    sheet = book[sheet_name]
    rows = [[('' if c is None else str(c)).replace('_x000D_', '').strip()
             for c in row] for row in sheet.iter_rows(values_only=True)]
    teachers = {}
    i = 0
    while i < len(rows):
        row = rows[i]
        if row and row[0] and row[1] == '월' and row[2] == '화':
            slots = [''] * 35
            for offset in range(1, 8):
                if i + offset >= len(rows):
                    break
                cells = rows[i + offset]
                matched = re.match(r'(\d)교시', cells[0] or '')
                if not matched:
                    break
                period = int(matched.group(1))
                for day in range(5):
                    value = cells[1 + day]
                    if value:
                        slots[day * 7 + period - 1] = ' '.join(value.split())
            teachers[row[0]] = slots
            i += 8
        else:
            i += 1
    return teachers


def write(teachers, out_path, semester, source, updated):
    header = (
        '/* %s 교사시간표 — "%s"에서 자동 변환(tools/build-teacher-timetable.py).\n'
        '   슬롯 배열은 35칸: index = 요일(0=월…4=금) * 7 + (교시-1). 빈 문자열이면 공강.\n'
        '   값 형식은 "반 과목" (예: "104 국어A"). 시간표가 바뀌면 이 파일만 교체하면 된다. */\n'
        % (semester, source)
    )
    meta = ('  meta: { semester: %s, source: %s, updated: %s, '
            'days: ["월", "화", "수", "목", "금"], periods: 7 },\n'
            % (json.dumps(semester, ensure_ascii=False),
               json.dumps(source, ensure_ascii=False),
               json.dumps(updated, ensure_ascii=False)))
    body = ',\n'.join(
        '    %s: %s' % (json.dumps(name, ensure_ascii=False),
                        json.dumps(slots, ensure_ascii=False))
        for name, slots in teachers.items())
    with io.open(out_path, 'w', encoding='utf-8') as out:
        out.write(header + 'window.TEACHER_TIMETABLE = {\n' + meta
                  + '  teachers: {\n' + body + '\n  }\n};\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('xlsx')
    parser.add_argument('--out', default='teacher-timetable.js')
    parser.add_argument('--semester', default='2026학년도 2학기')
    parser.add_argument('--updated', default='')
    args = parser.parse_args()

    teachers = parse(args.xlsx)
    source = os.path.basename(args.xlsx)
    write(teachers, args.out, args.semester, os.path.splitext(source)[0], args.updated)
    filled = sum(1 for slots in teachers.values() for slot in slots if slot)
    print('교사 %d명 · 수업 %d칸 → %s' % (len(teachers), filled, args.out))


if __name__ == '__main__':
    main()
