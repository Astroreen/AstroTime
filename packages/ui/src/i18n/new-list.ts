// "+ New list"'s strings (docs/plans/design.md#D276), in a catalog of its
// own (`later.ts`) that loads with its dialog.
import { laterStrings } from "./later.ts";

export const newListStrings = {
  en: {
    "newList.title": "New list",
    "newList.name": "Name",
    "newList.where": "Where",
    "newList.make": "Create",
    "newList.cancel": "Cancel",
    "newList.close": "Close",
    "newList.making": "Making the list on {{account}}…",
    "newList.offline":
      "{{account}} cannot be reached, so the list was not made. Try again once it can.",
    "newList.unsupported": "The server of {{account}} does not make lists.",
    "newList.refused": "{{account}} did not allow the list to be made.",
    "newList.signed-out": "Sign in to {{account}} again to make a list there.",
    "newList.failed": "The list was not made: {{message}}",
    "newList.unloaded":
      "The accounts could not be read, so the list can be made on this device only.",
  },
  ru: {
    "newList.title": "Новый список",
    "newList.name": "Название",
    "newList.where": "Где",
    "newList.make": "Создать",
    "newList.cancel": "Отмена",
    "newList.close": "Закрыть",
    "newList.making": "Список создаётся в {{account}}…",
    "newList.offline":
      "{{account}} недоступен, список не создан. Попробуйте снова, когда связь будет.",
    "newList.unsupported": "Сервер {{account}} не создаёт списки.",
    "newList.refused": "{{account}} не разрешил создать список.",
    "newList.signed-out": "Войдите в {{account}} снова, чтобы создать там список.",
    "newList.failed": "Список не создан: {{message}}",
    "newList.unloaded":
      "Не удалось прочитать аккаунты, поэтому список можно создать только на этом устройстве.",
  },
} as const;

export const addNewListStrings = laterStrings(newListStrings);
