import { notFound } from 'next/navigation';
export default async function P({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; if (slug !== 'yes') notFound(); return <p>yes</p>; }
