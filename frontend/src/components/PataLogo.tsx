import { useId, forwardRef, SVGProps } from 'react';

export interface PataLogoProps extends SVGProps<SVGSVGElement> {
  className?: string;
}

export const PataLogo = forwardRef<SVGSVGElement, PataLogoProps>(function PataLogo(
  { className = 'w-4 h-4', ...props }: PataLogoProps,
  ref
) {
  const rawId = useId();
  // 清理 React useId 中可能含有的冒号等字符，确保在 SVG id 与 url(#id) 中安全
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, '');

  const sceneShadowId = `sceneShadow-${id}`;
  const paperShadowId = `paperShadow-${id}`;
  const sparkGlowId = `sparkGlow-${id}`;
  const purpleBackId = `purpleBack-${id}`;
  const yellowMiddleId = `yellowMiddle-${id}`;
  const whiteLeafId = `whiteLeaf-${id}`;
  const leafEdgeId = `leafEdge-${id}`;
  const sparkYellowId = `sparkYellow-${id}`;

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 828 816"
      role="img"
      aria-label="啪嗒 Pata 品牌标识"
      className={`pata-logo-svg ${className}`.trim()}
      {...props}
    >
      <defs>
        <linearGradient id={purpleBackId} x1="0" y1=".1" x2="1" y2="1">
          <stop stopColor="#FF9D40" />
          <stop offset=".4" stopColor="#FF5DAE" />
          <stop offset=".74" stopColor="#AD50F0" />
          <stop offset="1" stopColor="#606FFB" />
        </linearGradient>
        <linearGradient id={yellowMiddleId} x1=".1" y1=".03" x2=".83" y2="1">
          <stop stopColor="#FFEE57" />
          <stop offset=".3" stopColor="#FFC63B" />
          <stop offset=".69" stopColor="#FF9C46" />
          <stop offset="1" stopColor="#FFBB76" />
        </linearGradient>
        <linearGradient id={whiteLeafId} x1=".15" y1="0" x2=".92" y2="1">
          <stop stopColor="#FFFFF7" />
          <stop offset=".26" stopColor="#FFF6ED" />
          <stop offset=".57" stopColor="#F9F5FE" />
          <stop offset=".83" stopColor="#E8ECFF" />
          <stop offset="1" stopColor="#FFFDFB" />
        </linearGradient>
        <linearGradient id={leafEdgeId} x1=".1" y1="0" x2=".5" y2="1">
          {/* 起始端微调为淡紫灰 (#E2DAF0)，增强浅色标题栏背景下的白色顶层轮廓可辨度 */}
          <stop stopColor="#E2DAF0" />
          <stop offset=".6" stopColor="#FFF7F3" />
          <stop offset="1" stopColor="#E1D5FF" />
        </linearGradient>
        <linearGradient id={sparkYellowId} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#FFE843" />
          <stop offset=".57" stopColor="#FFBD17" />
          <stop offset="1" stopColor="#FF8E25" />
        </linearGradient>
        <filter id={sceneShadowId} x="-40%" y="-40%" width="180%" height="190%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
        <filter id={paperShadowId} x="-30%" y="-30%" width="170%" height="180%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <filter id={sparkGlowId} x="-90%" y="-90%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      <g id="pata-symbol" className="pata-symbol">
        {/* 底层卡片 (粉紫，内含首位柔和投影以实现回弹随动) */}
        <g id="pata-card-back" className="pata-card pata-card-back">
          <path
            className="pata-card-shadow pata-shadow-back"
            d="M166 343 C176 330 188 322 204 318 C221 313 237 314 254 319 L477 365 C517 374 550 414 579 475 C604 527 601 566 567 586 C559 592 546 597 533 602 L344 668 C297 683 265 663 243 630 C222 596 198 538 177 490 L143 408 C132 375 150 354 166 343 Z"
            fill="#803ACD"
            opacity=".22"
            transform="translate(5 12)"
            filter={`url(#${sceneShadowId})`}
          />
          <path
            d="M166 343 C176 330 188 322 204 318 C221 313 237 314 254 319 L477 365 C517 374 550 414 579 475 C604 527 601 566 567 586 C559 592 546 597 533 602 L344 668 C297 683 265 663 243 630 C222 596 198 538 177 490 L143 408 C132 375 150 354 166 343 Z"
            fill={`url(#${purpleBackId})`}
            stroke="#F7B6E5"
            strokeOpacity=".55"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <path
            d="M150 400 C159 445 202 551 245 630 C271 669 304 682 346 664"
            fill="none"
            stroke="#FFD1E8"
            strokeOpacity=".42"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
        {/* 中层卡片 (橙黄，内含首位柔和投影以实现回弹随动) */}
        <g id="pata-card-middle" className="pata-card pata-card-middle">
          <path
            className="pata-card-shadow pata-shadow-middle"
            d="M211 279 C231 270 248 269 266 275 L479 326 C523 340 553 380 575 441 C597 496 610 532 591 562 C584 573 571 581 551 588 L405 625 C354 642 320 626 295 586 C266 542 245 499 220 442 C193 382 184 345 193 304 C196 292 201 284 211 279 Z"
            fill="#DD747F"
            opacity=".22"
            transform="translate(3 7)"
            filter={`url(#${paperShadowId})`}
          />
          <path
            d="M211 279 C231 270 248 269 266 275 L479 326 C523 340 553 380 575 441 C597 496 610 532 591 562 C584 573 571 581 551 588 L405 625 C354 642 320 626 295 586 C266 542 245 499 220 442 C193 382 184 345 193 304 C196 292 201 284 211 279 Z"
            fill="#EC9770"
            opacity=".4"
            transform="translate(1.5 5)"
          />
          <path
            d="M211 279 C231 270 248 269 266 275 L479 326 C523 340 553 380 575 441 C597 496 610 532 591 562 C584 573 571 581 551 588 L405 625 C354 642 320 626 295 586 C266 542 245 499 220 442 C193 382 184 345 193 304 C196 292 201 284 211 279 Z"
            fill={`url(#${yellowMiddleId})`}
            stroke="#FFE596"
            strokeWidth="3.1"
            strokeLinejoin="round"
          />
          <path
            d="M202 304 C191 347 203 397 228 452 C255 511 281 559 307 595 C331 629 366 639 407 621"
            fill="none"
            stroke="#FFEFBA"
            strokeOpacity=".55"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
        {/* 顶层卡片 (折叠白卡，内含首位柔和投影以实现回弹随动) */}
        <g id="pata-card-front" className="pata-card pata-card-front">
          <path
            className="pata-card-shadow pata-shadow-front"
            d="M310 224 C331 224 345 229 362 236 L484 279 C527 295 539 316 560 366 C569 388 579 409 591 432 C607 456 639 470 664 487 C688 504 684 523 661 538 C648 547 633 550 610 556 L453 583 C402 592 366 577 342 544 C307 496 285 444 260 383 C243 341 234 301 240 269 C245 238 272 221 310 224 Z"
            fill="#9E8FC3"
            opacity=".17"
            transform="translate(5 9)"
            filter={`url(#${paperShadowId})`}
          />
          <path
            d="M310 224 C331 224 345 229 362 236 L484 279 C527 295 539 316 560 366 C569 388 579 409 591 432 C607 456 639 470 664 487 C688 504 684 523 661 538 C648 547 633 550 610 556 L453 583 C402 592 366 577 342 544 C307 496 285 444 260 383 C243 341 234 301 240 269 C245 238 272 221 310 224 Z"
            fill="#D7D0F2"
            opacity=".72"
            transform="translate(1 5)"
          />
          <path
            d="M310 224 C331 224 345 229 362 236 L484 279 C527 295 539 316 560 366 C569 388 579 409 591 432 C607 456 639 470 664 487 C688 504 684 523 661 538 C648 547 633 550 610 556 L453 583 C402 592 366 577 342 544 C307 496 285 444 260 383 C243 341 234 301 240 269 C245 238 272 221 310 224 Z"
            fill={`url(#${whiteLeafId})`}
            stroke={`url(#${leafEdgeId})`}
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <path
            d="M308 227 C277 223 252 237 246 270 C241 302 251 352 270 402 C290 454 317 515 346 547 C370 581 404 589 451 582"
            fill="none"
            stroke="#FFFFFF"
            strokeOpacity=".82"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M341 545 C368 582 403 592 453 586 L611 560 C634 555 648 550 664 539"
            fill="none"
            stroke="#C6BEEF"
            strokeOpacity=".4"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </g>
        {/* 三道光芒 */}
        <g id="pata-sparkles" className="pata-sparkles">
          <g opacity=".14" fill="#FF9923" filter={`url(#${sparkGlowId})`}>
            <rect className="pata-sparkle pata-sparkle-1" x="488" y="143" width="44" height="105" rx="23" />
            <rect className="pata-sparkle pata-sparkle-2" x="575" y="169" width="47" height="109" rx="24" transform="rotate(47 599 222)" />
            <rect className="pata-sparkle pata-sparkle-3" x="605" y="316" width="96" height="44" rx="22" transform="rotate(8 653 338)" />
          </g>
          <g fill={`url(#${sparkYellowId})`} stroke="#FFE277" strokeWidth="1.5">
            <rect className="pata-sparkle pata-sparkle-1" x="490" y="143" width="42" height="103" rx="21" transform="rotate(-1 511 195)" />
            <rect className="pata-sparkle pata-sparkle-2" x="575" y="171" width="45" height="105" rx="22.5" transform="rotate(46 598 224)" />
            <rect className="pata-sparkle pata-sparkle-3" x="602" y="318" width="103" height="43" rx="21.5" transform="rotate(6 653 339)" />
          </g>
        </g>
      </g>
    </svg>
  );
});
