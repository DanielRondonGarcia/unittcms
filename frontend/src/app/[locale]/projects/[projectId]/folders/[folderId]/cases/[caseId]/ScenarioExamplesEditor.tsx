import { Button } from '@heroui/react';
import { Plus, Trash2 } from 'lucide-react';
import type { CaseMessages, GherkinExamples } from '@/types/case';

type Props = {
  value: GherkinExamples | null | undefined;
  isDisabled: boolean;
  messages: CaseMessages;
  onChange: (value: GherkinExamples | null) => void;
};

const emptyExamples = (): GherkinExamples => ({ headers: ['value'], rows: [['']] });

export default function ScenarioExamplesEditor({ value, isDisabled, messages, onChange }: Props) {
  const updateHeader = (index: number, header: string) => {
    if (!value) return;
    onChange({
      headers: value.headers.map((item, itemIndex) => (itemIndex === index ? header : item)),
      rows: value.rows.map((row) => [...row]),
    });
  };

  const updateCell = (rowIndex: number, columnIndex: number, cell: string) => {
    if (!value) return;
    onChange({
      headers: [...value.headers],
      rows: value.rows.map((row, itemIndex) =>
        itemIndex === rowIndex ? row.map((item, cellIndex) => (cellIndex === columnIndex ? cell : item)) : [...row]
      ),
    });
  };

  const addRow = () => {
    if (!value) return;
    onChange({ headers: [...value.headers], rows: [...value.rows, value.headers.map(() => '')] });
  };

  const removeRow = (rowIndex: number) => {
    if (!value) return;
    onChange({
      headers: [...value.headers],
      rows: value.rows.filter((_, index) => index !== rowIndex).map((row) => [...row]),
    });
  };

  const addColumn = () => {
    if (!value) return;
    onChange({ headers: [...value.headers, ''], rows: value.rows.map((row) => [...row, '']) });
  };

  const removeColumn = (columnIndex: number) => {
    if (!value) return;
    onChange({
      headers: value.headers.filter((_, index) => index !== columnIndex),
      rows: value.rows.map((row) => row.filter((_, index) => index !== columnIndex)),
    });
  };

  if (!value || !Array.isArray(value.headers) || !Array.isArray(value.rows)) {
    return (
      <section aria-labelledby="gherkin-examples-heading" className="mt-6 min-w-0 rounded-lg border border-dashed p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h6 id="gherkin-examples-heading" className="font-bold">
              {messages.examples}
            </h6>
            <p className="mt-1 text-sm text-default-500">{messages.noExamples}</p>
          </div>
          <Button
            startContent={<Plus size={16} aria-hidden="true" />}
            isDisabled={isDisabled}
            size="sm"
            variant="flat"
            onPress={() => onChange(emptyExamples())}
          >
            {messages.addExamples}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="gherkin-examples-heading" className="mt-6 min-w-0 rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h6 id="gherkin-examples-heading" className="font-bold">
          {messages.examples}
        </h6>
        <Button size="sm" variant="light" color="danger" isDisabled={isDisabled} onPress={() => onChange(null)}>
          {messages.removeExamples}
        </Button>
      </div>

      {value.headers.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-default-500">{messages.noExamples}</p>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="min-w-max border-collapse text-sm" aria-label={messages.examples}>
            <thead>
              <tr className="border-b">
                {value.headers.map((header, columnIndex) => (
                  <th key={`header-${columnIndex}`} scope="col" className="min-w-40 p-2 text-start align-top">
                    <label className="flex flex-col gap-1 font-normal">
                      <span className="text-xs text-default-500">{messages.exampleHeader}</span>
                      <input
                        type="text"
                        name={`gherkin-example-header-${columnIndex}`}
                        aria-label={`${messages.exampleHeader} ${columnIndex + 1}`}
                        value={header}
                        disabled={isDisabled}
                        onChange={(event) => updateHeader(columnIndex, event.target.value)}
                        className="w-full rounded-md border border-default-300 bg-transparent px-2 py-1 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      />
                    </label>
                    <Button
                      isIconOnly
                      aria-label={`${messages.removeExampleColumn}: ${columnIndex + 1}`}
                      size="sm"
                      variant="light"
                      isDisabled={isDisabled}
                      className="mt-1 focus-visible:ring-2 focus-visible:ring-primary"
                      onPress={() => removeColumn(columnIndex)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </Button>
                  </th>
                ))}
                <th scope="col" className="w-10 p-2" aria-label={messages.removeExampleColumn} />
              </tr>
            </thead>
            <tbody>
              {value.rows.length === 0 ? (
                <tr>
                  <td colSpan={value.headers.length + 1} className="p-3 text-center text-default-500">
                    {messages.noExamples}
                  </td>
                </tr>
              ) : (
                value.rows.map((row, rowIndex) => (
                  <tr key={`row-${rowIndex}`} className="border-b last:border-b-0">
                    {row.map((cell, columnIndex) => (
                      <td key={`cell-${rowIndex}-${columnIndex}`} className="p-2">
                        <input
                          type="text"
                          name={`gherkin-example-${rowIndex}-${columnIndex}`}
                          aria-label={`${messages.exampleValue} ${rowIndex + 1}, ${columnIndex + 1}`}
                          value={cell}
                          disabled={isDisabled}
                          onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)}
                          className="w-full rounded-md border border-default-300 bg-transparent px-2 py-1 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        />
                      </td>
                    ))}
                    <td className="p-2 align-top">
                      <Button
                        isIconOnly
                        aria-label={`${messages.removeExampleRow}: ${rowIndex + 1}`}
                        size="sm"
                        variant="light"
                        isDisabled={isDisabled}
                        className="focus-visible:ring-2 focus-visible:ring-primary"
                        onPress={() => removeRow(rowIndex)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          startContent={<Plus size={16} aria-hidden="true" />}
          size="sm"
          variant="flat"
          isDisabled={isDisabled}
          onPress={addRow}
        >
          {messages.addExampleRow}
        </Button>
        <Button
          startContent={<Plus size={16} aria-hidden="true" />}
          size="sm"
          variant="flat"
          isDisabled={isDisabled}
          onPress={addColumn}
        >
          {messages.addExampleColumn}
        </Button>
      </div>
    </section>
  );
}
