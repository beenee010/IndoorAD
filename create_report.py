from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches

OUTPUT = '공기질_측정_경고_대시보드_개발_보고서.docx'
PAGE_IMAGE = '공기질_측정_경고_대시보드_개발_보고서.png'
FONT = '/Users/been/Library/Fonts/NanumSquareR.ttf'
BOLD_FONT = '/Users/been/Library/Fonts/NanumSquareB.ttf'

def wrap(draw, text, font, width):
    lines = []
    current = ''
    for char in text:
        candidate = current + char
        if draw.textlength(candidate, font=font) <= width:
            current = candidate
        else:
            lines.append(current)
            current = char
    if current:
        lines.append(current)
    return lines

image = Image.new('RGB', (1650, 2140), 'white')
draw = ImageDraw.Draw(image)
title_font = ImageFont.truetype(BOLD_FONT, 52)
heading_font = ImageFont.truetype(BOLD_FONT, 29)
body_font = ImageFont.truetype(FONT, 23)
intro_font = ImageFont.truetype(FONT, 25)
blue = '#245b9f'
ink = '#172b4d'
muted = '#50647f'
left = 150
right = 1500
cursor = 155

draw.rectangle((left, 115, left + 12, 196), fill=blue)
draw.text((left + 32, cursor), '공기질 측정과 경고 대시보드 개발 보고서', font=title_font, fill=ink)
cursor += 105
draw.line((left, cursor, right, cursor), fill='#c9d7eb', width=2)
cursor += 48

intro = '본 보고서는 공공 대기질 정보와 현장 센서 측정값을 활용하는 관리자용 공기질 관리 시스템의 현재 개발 내용을 정리한다'
for line in wrap(draw, intro, intro_font, right - left):
    draw.text((left, cursor), line, font=intro_font, fill=muted)
    cursor += 38
cursor += 25

sections = [
    ('개발 목표', [
        '관리자가 지역별 대기질과 경고 상태를 한 화면에서 확인하고 기준 초과 가능성을 미리 파악할 수 있는 대시보드를 구축한다',
        '향후에는 아두이노 기반 센서의 현장 측정값을 결합해 실내와 외부 대기질을 함께 관리한다',
    ]),
    ('현재 구현 내용', [
        '관리자 대시보드 화면을 구현했다',
        '측정소 현황 활성 경고 AI 예측 추이와 주요 지표를 제공한다',
        '에어코리아 API 연결을 위한 서버 프록시를 구현했고 API 키는 서버 환경변수로 관리한다',
    ]),
    ('에어코리아 연동 방식', [
        '측정소 이름을 기준으로 최신 대기오염 측정값을 조회한다',
        'PM25 PM10 통합대기환경지수와 측정 시각을 대시보드에 표시한다',
        '종로구를 기본 측정소로 설정했고 중구 강남구 수원시 부평구를 선택할 수 있다',
    ]),
    ('아두이노 센서 연계 방향', [
        '에어코리아는 지역의 공인 외부 대기질 정보를 제공하고 센서 장치는 설치 장소의 현장 공기질을 측정한다',
        'ESP32와 PM25 PM10 온습도 CO2 센서를 결합하면 현장 변화와 환기 상태를 함께 판단할 수 있다',
    ]),
    ('다음 단계', [
        '에어코리아 API 인증키를 서버 환경변수에 설정한다',
        '실측 데이터 저장과 시간별 변화 추이를 추가한다',
        '아두이노 센서 데이터와 경고 기준 AI 예측 모델을 연결한다',
    ]),
]

for heading, points in sections:
    draw.text((left, cursor), heading, font=heading_font, fill=ink)
    cursor += 46
    for point in points:
        for index, line in enumerate(wrap(draw, point, body_font, right - left - 42)):
            x = left
            draw.text((x, cursor), line, font=body_font, fill=muted)
            cursor += 34
        cursor += 8
    cursor += 18

image.save(PAGE_IMAGE)
doc = Document()
section = doc.sections[0]
section.top_margin = Inches(0.35)
section.bottom_margin = Inches(0.35)
section.left_margin = Inches(0.35)
section.right_margin = Inches(0.35)
paragraph = doc.add_paragraph()
paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
paragraph.paragraph_format.space_after = 0
paragraph.add_run().add_picture(PAGE_IMAGE, width=Inches(7.78))
doc.core_properties.title = '공기질 측정과 경고 대시보드 개발 보고서'
doc.core_properties.author = 'AirGuard'
doc.save(OUTPUT)
