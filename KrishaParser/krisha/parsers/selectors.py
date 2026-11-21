from __future__ import annotations

import re

WINDOW_DATA_RE = re.compile(r"window\.data\s*=\s*(\{.*?\});", re.S)

CARD = "div.a-card[data-id]"
CARD_TITLE = ".a-card__title"
CARD_PRICE = ".a-card__price"
CARD_SUBTITLE = ".a-card__subtitle"
CARD_DESCR = ".a-card__descr"

INFO_ITEM = "div.offer__info-item"
INFO_TITLE = ".offer__info-title"
INFO_VALUE = ".offer__advert-short-info"
PARAMETER_ROW = ".offer__parameters dl"
PARAMETER_NAME = "dt[data-name]"
PARAMETER_VALUE = "dd"
DESCRIPTION = ".offer__description"
TITLE_H1 = "h1"

PARAM_MAP: dict[str, str] = {
    "flat.building": "building_type",
    "house.year": "year_built",
    "flat.floor": "_floor",
    "live.square": "_square",
    "flat.renovation": "renovation_text",
    "flat.rent_renovation": "_renovation_extra",
    "flat.toilet": "bathroom",
    "flat.bath": "bathroom",
    "separated_toilet": "bathroom",
    "flat.balcony": "balcony",
    "balcony_count": "_balcony_count",
    "loggia_count": "_loggia_count",
    "live.furniture": "furniture",
    "flat.furniture": "furniture",
    "map.complex": "complex_name",
    "flat.priedomovaya_territoriya": "_ignore",
}
