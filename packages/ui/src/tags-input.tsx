import type {
  ComponentPropsWithoutRef,
  KeyboardEvent,
  Ref,
  RefObject,
} from "react";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

const DEFAULT_COMMIT_KEYS: readonly string[] = ["Enter"];

export interface TagsInputApi {
  value: readonly string[];
  add: (text: string) => void;
}

interface RootState extends TagsInputApi {
  inputValue: string;
  setInputValue: (text: string) => void;
  removeAt: (index: number) => void;
  commitKeys: readonly string[];
  inputRef: RefObject<HTMLInputElement | null>;
  attachInput: (input: HTMLInputElement | null) => void;
}

interface ItemState {
  value: string;
  index: number;
}

const RootContext = createContext<RootState | null>(null);
const ItemContext = createContext<ItemState | null>(null);

function useRoot(): RootState {
  const state = useContext(RootContext);
  if (!state) throw new Error("TagsInput part rendered outside TagsInput.Root");
  return state;
}

function useItem(): ItemState {
  const item = useContext(ItemContext);
  if (!item)
    throw new Error("TagsInput item part rendered outside TagsInput.Item");
  return item;
}

export function useTagsInput(): TagsInputApi {
  const { value, add } = useRoot();
  return { value, add };
}

type RootProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "onChange" | "defaultValue"
> & {
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  commitKeys?: readonly string[];
};

function Root({
  value,
  onValueChange,
  commitKeys = DEFAULT_COMMIT_KEYS,
  onMouseDown,
  ...props
}: RootProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const attachInput = useCallback((input: HTMLInputElement | null) => {
    inputRef.current = input;
  }, []);
  const state: RootState = {
    value,
    inputValue,
    setInputValue,
    add(text) {
      const name = text.trim();
      if (name === "") return;
      setInputValue("");
      if (!value.includes(name)) onValueChange([...value, name]);
    },
    removeAt(index) {
      onValueChange(value.filter((_, at) => at !== index));
    },
    commitKeys,
    inputRef,
    attachInput,
  };
  return (
    <RootContext.Provider value={state}>
      <div
        {...props}
        data-slot="tags-input"
        onMouseDown={(event) => {
          onMouseDown?.(event);
          if (event.defaultPrevented || event.target !== event.currentTarget)
            return;
          event.preventDefault();
          inputRef.current?.focus();
        }}
      />
    </RootContext.Provider>
  );
}

type ItemProps = Omit<ComponentPropsWithoutRef<"div">, "value"> & {
  value: string;
  index?: number;
};

function Item({ value, index, ...props }: ItemProps) {
  const root = useRoot();
  const item = { value, index: index ?? root.value.indexOf(value) };
  return (
    <ItemContext.Provider value={item}>
      <div {...props} data-slot="tags-input-item" />
    </ItemContext.Provider>
  );
}

function ItemText(props: Omit<ComponentPropsWithoutRef<"span">, "children">) {
  const { value } = useItem();
  return (
    <span {...props} data-slot="tags-input-item-text">
      {value}
    </span>
  );
}

function ItemRemove({
  onMouseDown,
  onClick,
  ...props
}: ComponentPropsWithoutRef<"button">) {
  const root = useRoot();
  const { index } = useItem();
  return (
    <button
      type="button"
      {...props}
      data-slot="tags-input-item-remove"
      onMouseDown={(event) => {
        onMouseDown?.(event);
        event.preventDefault();
      }}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        const focused =
          event.currentTarget.ownerDocument.activeElement ===
          event.currentTarget;
        root.removeAt(index);
        if (focused) root.inputRef.current?.focus();
      }}
    />
  );
}

type InputProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "value" | "defaultValue"
> & {
  inputRef?: Ref<HTMLInputElement>;
};

function prevented<
  E extends { preventDefault(): void; defaultPrevented: boolean },
>(event: E, handler: ((event: E) => void) | undefined): boolean {
  if (!handler) return false;
  const own = Object.getOwnPropertyDescriptor(event, "preventDefault");
  const preventDefault = event.preventDefault.bind(event);
  let called = false;
  event.preventDefault = () => {
    called = true;
    preventDefault();
  };
  try {
    handler(event);
  } finally {
    if (own) Object.defineProperty(event, "preventDefault", own);
    else Reflect.deleteProperty(event, "preventDefault");
  }
  return called || event.defaultPrevented;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

function composing(event: KeyboardEvent<HTMLInputElement>): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

function Input({
  inputRef,
  onChange,
  onKeyDown,
  onBlur,
  ...props
}: InputProps) {
  const root = useRoot();
  const { attachInput } = root;
  const ref = useCallback(
    (input: HTMLInputElement | null) => {
      attachInput(input);
      assignRef(inputRef, input);
    },
    [attachInput, inputRef],
  );
  return (
    <input
      type="text"
      {...props}
      data-slot="tags-input-input"
      ref={ref}
      value={root.inputValue}
      onChange={(event) => {
        onChange?.(event);
        root.setInputValue(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (prevented(event, onKeyDown) || composing(event)) return;
        if (root.commitKeys.includes(event.key)) {
          event.preventDefault();
          root.add(root.inputValue);
        } else if (
          event.key === "Backspace" &&
          root.inputValue === "" &&
          root.value.length > 0
        ) {
          root.removeAt(root.value.length - 1);
        }
      }}
      onBlur={(event) => {
        if (prevented(event, onBlur)) return;
        root.add(root.inputValue);
      }}
    />
  );
}

export const TagsInput = { Root, Item, ItemText, ItemRemove, Input };
