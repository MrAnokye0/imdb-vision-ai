"use client";

import Image from "next/image";
import { Tag, Barcode, Globe, Package, Factory } from "lucide-react";
import type { ProductRecord } from "@/src/types/product";

interface ProductPreviewProps {
  product: ProductRecord;
}

export default function ProductPreview({ product }: ProductPreviewProps) {
  const confidencePct = Math.round(product.confidenceScore * 100);

  return (
    <article
      aria-label={`Product: ${product.productName}`}
      className="flex gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
    >
      {/* Thumbnail */}
      {(product.imageUrl || product.imageUrls?.[0]) ? (
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
          <Image
            src={(product.imageUrl || product.imageUrls?.[0]) ?? ""}
            alt={product.productName}
            fill
            sizes="80px"
            className="object-contain"
          />
        </div>
      ) : (
        <div
          aria-hidden="true"
          className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
        >
          <Tag className="h-8 w-8" />
        </div>
      )}

      {/* Details */}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {product.productName}
          </h3>
          {product.brand && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {product.brand}
            </span>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {product.categoryType && (
            <>
              <dt className="font-medium text-zinc-700 dark:text-zinc-300">Category</dt>
              <dd>{product.categoryType}</dd>
            </>
          )}
          {product.segmentType && (
            <>
              <dt className="font-medium text-zinc-700 dark:text-zinc-300">Segment</dt>
              <dd>{product.segmentType}</dd>
            </>
          )}
          {product.manufacturer && (
            <>
              <dt className="font-medium text-zinc-700 dark:text-zinc-300">
                <span className="inline-flex items-center gap-1">
                  <Factory className="h-3 w-3" aria-hidden="true" />
                  Manufacturer
                </span>
              </dt>
              <dd>{product.manufacturer}</dd>
            </>
          )}
          {product.weightUnit && (
            <>
              <dt className="font-medium text-zinc-700 dark:text-zinc-300">Weight / Vol</dt>
              <dd>{product.weightUnit}</dd>
            </>
          )}
          {product.packagingType && (
            <>
              <dt className="font-medium text-zinc-700 dark:text-zinc-300">
                <span className="inline-flex items-center gap-1">
                  <Package className="h-3 w-3" aria-hidden="true" />
                  Packaging
                </span>
              </dt>
              <dd>{product.packagingType}</dd>
            </>
          )}
          {product.countryOfOrigin && (
            <>
              <dt className="font-medium text-zinc-700 dark:text-zinc-300">
                <span className="inline-flex items-center gap-1">
                  <Globe className="h-3 w-3" aria-hidden="true" />
                  Origin
                </span>
              </dt>
              <dd>{product.countryOfOrigin}</dd>
            </>
          )}
        </dl>

        {product.barcode && (
          <p className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            <Barcode className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{product.barcode}</span>
          </p>
        )}

        {product.marketingMessage && (
          <p className="text-xs italic text-zinc-400 dark:text-zinc-500">
            &ldquo;{product.marketingMessage}&rdquo;
          </p>
        )}

        {/* Confidence bar */}
        <div
          className="mt-2"
          role="progressbar"
          aria-valuenow={confidencePct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Extraction confidence: ${confidencePct}%`}
        >
          <div className="flex justify-between text-xs text-zinc-400 dark:text-zinc-500">
            <span>Confidence</span>
            <span>{confidencePct}%</span>
          </div>
          <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
            <div
              className={`h-full rounded-full transition-all ${
                confidencePct >= 70
                  ? "bg-green-500"
                  : confidencePct >= 40
                  ? "bg-yellow-500"
                  : "bg-red-500"
              }`}
              style={{ width: `${confidencePct}%` }}
            />
          </div>
        </div>
      </div>
    </article>
  );
}
