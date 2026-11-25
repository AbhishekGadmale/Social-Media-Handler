import Image from 'next/image';
import { PLATFORM_BRANDS } from './platform-badge';

const PLATFORMS = [
  {
    ...PLATFORM_BRANDS.INSTAGRAM,
    positionClass: 'left-[13%] top-[59%]',
  },
  {
    ...PLATFORM_BRANDS.FACEBOOK,
    positionClass: 'left-[31%] top-[27%]',
  },
  {
    ...PLATFORM_BRANDS.YOUTUBE,
    positionClass: 'left-[69%] top-[27%]',
  },
  {
    ...PLATFORM_BRANDS.LINKEDIN,
    positionClass: 'left-[87%] top-[59%]',
  },
] as const;

/** Displays the Agency OS mark anchored beneath an arched "Works with" arrangement of supported social platform icons. */
export function HeroBrand() {
  return (
    <div className="pt-6 sm:pt-8 space-y-2">
      <p className="text-xs uppercase tracking-widest text-gray-500 text-center">Works with</p>
      <div
        className="relative mx-auto max-w-2xl h-56 sm:h-64"
        role="img"
        aria-label="Agency OS — works with Facebook, Instagram, LinkedIn and YouTube"
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full pointer-events-none"
          aria-hidden="true"
        >
          <path
            d="M 11.96 62.84 A 40 62 0 0 1 88.04 62.84"
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {PLATFORMS.map((platform) => (
          <svg
            key={platform.name}
            viewBox="0 0 24 24"
            className={`absolute -translate-x-1/2 -translate-y-1/2 w-12 h-12 ${platform.positionClass}`}
            fill={platform.color}
            aria-hidden="true"
          >
            <path d={platform.path} />
          </svg>
        ))}

        <Image
          src="/logo.svg"
          width={112}
          height={112}
          alt="Agency OS"
          className="absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 w-24 h-24 sm:w-28 sm:h-28"
        />
      </div>
      <p className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 text-center">
        Agency OS
      </p>
    </div>
  );
}
