import Image from 'next/image';
import { siFacebook, siInstagram, siYoutube } from 'simple-icons';

// simple-icons v12+ removed siLinkedin per trademark policy; path and brand hex preserved verbatim from simple-icons@11.15.0.
const LINKEDIN_ICON = {
  title: 'LinkedIn',
  hex: '0A66C2',
  path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
} as const;

const PLATFORMS = [
  {
    name: siInstagram.title,
    path: siInstagram.path,
    color: `#${siInstagram.hex}`,
    positionClass: 'left-[13%] top-[59%]',
  },
  {
    name: siFacebook.title,
    path: siFacebook.path,
    color: `#${siFacebook.hex}`,
    positionClass: 'left-[31%] top-[27%]',
  },
  {
    name: siYoutube.title,
    path: siYoutube.path,
    color: `#${siYoutube.hex}`,
    positionClass: 'left-[69%] top-[27%]',
  },
  {
    name: LINKEDIN_ICON.title,
    path: LINKEDIN_ICON.path,
    color: `#${LINKEDIN_ICON.hex}`,
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
