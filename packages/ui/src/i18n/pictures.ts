// The strings of the pictures' parts that load later: the user's own
// pictures in Settings (design D222, D223), a place photo's credit (D221),
// in a catalog of their own (`later.ts`): `addPictureStrings` adds them to
// the app's i18next when one of them first draws.
import { laterStrings } from "./later.ts";

export const pictureStrings = {
  en: {
    "ownPictures.words": "Your words and pictures",
    "ownPictures.add": "Add a word with a picture",
    "ownPictures.new": "A word's picture",
    "ownPictures.edit": "Change a word's picture",
    "ownPictures.word": "Word",
    "ownPictures.wordHint": "Items whose title has it are drawn over this picture",
    "ownPictures.choose": "Choose a picture",
    "ownPictures.notAPicture": "That file is not a picture this device can read",
    "ownPictures.save": "Save",
    "ownPictures.delete": "Delete",
    "ownPictures.close": "Close",
    "ownPictures.banners": "Your month banners",
    "ownPictures.bannersHint": "Kept on this device",
    "ownPictures.chooseFor": "Choose a picture for {{month}}",
    "ownPictures.reset": "Back to AstroTime's for {{month}}",
    "pictures.wikipedia": "Wikipedia",
  },
  ru: {
    "ownPictures.words": "Ваши слова и картинки",
    "ownPictures.add": "Добавить слово с картинкой",
    "ownPictures.new": "Картинка для слова",
    "ownPictures.edit": "Изменить картинку слова",
    "ownPictures.word": "Слово",
    "ownPictures.wordHint": "Дела с ним в названии показываются с этой картинкой",
    "ownPictures.choose": "Выбрать картинку",
    "ownPictures.notAPicture": "Этот файл — не картинка, которую может открыть устройство",
    "ownPictures.save": "Сохранить",
    "ownPictures.delete": "Удалить",
    "ownPictures.close": "Закрыть",
    "ownPictures.banners": "Ваши картинки месяцев",
    "ownPictures.bannersHint": "Хранятся на этом устройстве",
    "ownPictures.chooseFor": "Выбрать картинку для месяца {{month}}",
    "ownPictures.reset": "Вернуть картинку AstroTime для месяца {{month}}",
    "pictures.wikipedia": "Википедия",
  },
} as const satisfies Record<"en" | "ru", Record<string, string>>;

/** Adds the strings to an i18next instance in every language, once. */
export const addPictureStrings = laterStrings(pictureStrings);
