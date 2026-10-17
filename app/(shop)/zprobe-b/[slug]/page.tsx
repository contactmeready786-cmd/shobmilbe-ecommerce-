import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> { const { slug } = await params; if (slug !== 'yes') notFound(); return { title: 'yes' }; }
export default async function P({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; if (slug !== 'yes') notFound(); return <p>yes</p>; }
