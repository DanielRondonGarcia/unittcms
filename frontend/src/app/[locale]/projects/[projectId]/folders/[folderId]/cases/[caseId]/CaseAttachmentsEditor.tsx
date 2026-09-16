import { Image, Button, Tooltip, Card, CardBody } from '@heroui/react';
import { Trash, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { ChangeEvent, DragEvent, useEffect, useState } from 'react';
import { isImage } from './isImage';
import { fetchAttachmentPreview } from './attachmentControl';
import { AttachmentType, CaseMessages } from '@/types/case';

type Props = {
  isDisabled: boolean;
  token: string;
  attachments: AttachmentType[];
  onAttachmentDownload: (attachmentId: number, downloadFileName: string) => void;
  onAttachmentDelete: (attachmentId: number) => void;
  onFilesDrop: (event: DragEvent<HTMLElement>) => void;
  onFilesInput: (event: ChangeEvent) => void;
  messages: CaseMessages;
};

function RasterPreview({ image, token }: { image: AttachmentType; token: string }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    let objectUrl: string | undefined;
    setPreviewUrl(null);

    void fetchAttachmentPreview(token, image.id)
      .then((blob) => {
        if (!isCurrent) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch(() => {
        // Failed or unauthorized previews render no bytes.
      });

    return () => {
      isCurrent = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [image.id, token]);

  if (!previewUrl) {
    return null;
  }

  return <Image alt={image.title} src={previewUrl} className="object-cover h-40 w-40" />;
}

export default function CaseAttachmentsEditor({
  isDisabled = false,
  token,
  attachments = [],
  onAttachmentDownload,
  onAttachmentDelete,
  onFilesDrop,
  onFilesInput,
  messages,
}: Props) {
  const images: AttachmentType[] = [];
  const others: AttachmentType[] = [];

  attachments.forEach((attachment) => {
    if (isImage(attachment)) {
      images.push(attachment);
    } else {
      others.push(attachment);
    }
  });
  return (
    <>
      <div className="flex flex-wrap mt-3">
        {images.map((image) => (
          <Card key={image.id} radius="sm" className="mt-2 me-2 max-w-md">
            <CardBody>
              <RasterPreview image={image} token={token} />
              <div className="flex items-center justify-between">
                <p>{image.title}</p>
                <Tooltip content={messages.delete}>
                  <Button
                    isIconOnly
                    size="sm"
                    isDisabled={isDisabled}
                    className="bg-transparent rounded-full"
                    onPress={() => onAttachmentDelete(image.id)}
                  >
                    <Trash size={16} />
                  </Button>
                </Tooltip>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {others.map((file, index) => (
        <Card key={index} radius="sm" className="mt-2 max-w-md">
          <CardBody>
            <div className="flex items-center justify-between">
              <p>{file.title}</p>
              <div>
                <Tooltip content={messages.download}>
                  <Button
                    isIconOnly
                    size="sm"
                    className="bg-transparent rounded-full"
                    onPress={() => onAttachmentDownload(file.id, file.title)}
                  >
                    <ArrowDownToLine size={16} />
                  </Button>
                </Tooltip>
                <Tooltip content={messages.delete}>
                  <Button
                    isIconOnly
                    size="sm"
                    className="bg-transparent rounded-full"
                    onPress={() => onAttachmentDelete(file.id)}
                  >
                    <Trash size={16} />
                  </Button>
                </Tooltip>
              </div>
            </div>
          </CardBody>
        </Card>
      ))}

      <div
        className="flex items-center justify-center w-96 mt-3"
        onDrop={(event) => {
          if (isDisabled) {
            return;
          }
          onFilesDrop(event);
        }}
        onDragOver={(event) => event.preventDefault()}
      >
        <label
          htmlFor="dropzone-file"
          className={`flex flex-col items-center justify-center w-full h-32 border-2 border-neutral-200 border-dashed rounded-lg  bg-neutral-50 dark:hover:bg-bray-800 dark:bg-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:hover:border-neutral-500 dark:hover:bg-neutral-600 ${isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        >
          <div className="flex flex-col items-center justify-center pt-5 pb-6">
            <ArrowUpFromLine />
            <p className="mb-2 text-sm text-neutral-500 dark:text-neutral-400">
              <span className="font-semibold">{messages.clickToUpload}</span>
              <span>{messages.orDragAndDrop}</span>
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{messages.maxFileSize}: 50 MB</p>
          </div>
          <input
            id="dropzone-file"
            type="file"
            className="hidden"
            disabled={isDisabled}
            onChange={(e) => onFilesInput(e)}
            multiple
          />
        </label>
      </div>
    </>
  );
}
