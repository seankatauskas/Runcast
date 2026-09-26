import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useIntroduction } from '../src/introduction/IntroductionProvider';

/** Start a fresh replay before returning to the existing Explorer screen. */
export default function GettingStartedRoute() {
  const introduction = useIntroduction();
  const router = useRouter();

  useEffect(() => {
    introduction.begin('replay');
    router.dismissTo('/');
  }, [introduction.begin, router]);

  return null;
}
