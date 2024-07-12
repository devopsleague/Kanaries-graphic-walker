import { ComponentType, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { IComputationFunction, ISemanticType } from '../../interfaces';
import { profileNonmialField, profileQuantitativeField, wrapComputationWithTag } from '../../computation';
import React from 'react';
import { formatDate, isNotEmpty } from '../../utils';
import Tooltip from '../tooltip';
import { themeContext, vegaThemeContext } from '../../store/theme';
import { parsedOffsetDate } from '../../lib/op/offset';
import embed, { VisualizationSpec } from 'vega-embed';
import { format } from 'd3-format';
import { getTheme } from '../../utils/useTheme';

export interface FieldProfilingProps {
    field: string;
    dataset: string;
    computation: IComputationFunction | IComputationFunction[];
}

function NominalProfiling({
    computation,
    field,
    dataset,
    valueRenderer = (s) => `${s}`,
}: FieldProfilingProps & { valueRenderer?: (v: string | number) => string }) {
    const [stat, setStat] = useState<Awaited<ReturnType<typeof profileNonmialField>>>();
    const [secStat, setSecStat] = useState<Awaited<ReturnType<typeof profileNonmialField>>>();
    useEffect(() => {
        if (Array.isArray(computation)) {
            profileNonmialField(wrapComputationWithTag(computation[0], 'profiling'), field, dataset).then(setStat);
            profileNonmialField(wrapComputationWithTag(computation[1], 'profiling'), field, dataset).then(setSecStat);
        } else {
            profileNonmialField(wrapComputationWithTag(computation, 'profiling'), field, dataset).then(setStat);
        }
    }, [computation, field]);

    if (!isNotEmpty(stat)) {
        return <div className="h-24 flex items-center justify-center">Loading...</div>;
    }

    const render = (value) => {
        const displayValue = valueRenderer(value);
        if (!displayValue) {
            return <span className="text-destructive">(Empty)</span>;
        }
        return displayValue;
    };

    const renderer = (data: typeof stat) => {
        const [meta, tops] = data;
        // shows top 2 when the maximum quantity is more than 1.3x the average quantity, and over 1%.
        // or there are lower than 10 unique values.
        const showsTops = meta.distinctTotal < 10 || (tops[0].count > (1.3 * meta.total) / meta.distinctTotal && tops[0].count > meta.total / 100);

        if (meta.distinctTotal === 1) {
            return <div className="h-24 flex items-center justify-center text-xl px-1">= {render(tops[0].value)}</div>;
        }

        return (
            <div className="h-24 flex items-center justify-center flex-col gap-2 text-xs px-1">
                {showsTops && (
                    <>
                        {tops.map(({ count, value }, idx) => {
                            const displayValue = render(value);
                            return (
                                <Tooltip key={idx} content={displayValue}>
                                    <div className="w-full rounded-md px-2 py-1 hover:bg-accent flex justify-between space-x-2">
                                        <div className="min-w-[0px] flex-shrink truncate max-w-[180px]">{displayValue}</div>
                                        <div className="flex-shrink-0">{Math.floor((100 * count) / meta.total)}%</div>
                                    </div>
                                </Tooltip>
                            );
                        })}
                        {meta.distinctTotal > tops.length && (
                            <div className="w-full rounded-md px-2 py-1 text-muted-foreground hover:bg-accent flex justify-between space-x-2">
                                <div className="min-w-[0px] flex-shrink whitespace-nowrap text-ellipsis overflow-hidden">
                                    Other ({meta.distinctTotal - tops.length})
                                </div>
                                <div className="flex-shrink-0">
                                    {100 - tops.reduce((totalPercent, { count }) => totalPercent + Math.floor((100 * count) / meta.total), 0)}%
                                </div>
                            </div>
                        )}
                    </>
                )}
                {!showsTops && (
                    <>
                        <div className="text-lg">{meta.distinctTotal}</div>
                        <div>unique values</div>
                    </>
                )}
            </div>
        );
    };

    if (!secStat) {
        return renderer(stat);
    }

    return (
        <div className="h-24 w-full flex divide-x">
            {renderer(stat)}
            {renderer(secStat)}
        </div>
    );
}

const formatter = (x) => {
    const abs = Math.abs(x);
    if (abs > 0) {
        const log = Math.floor(Math.log10(abs));
        if (Math.abs(log) > 26) {
            return format('~e')(x);
        }
    }
    return format('~s')(x);
};

function QuantitativeProfiling({ computation, field, dataset }: FieldProfilingProps) {
    const [stat, setStat] = useState<Awaited<ReturnType<typeof profileQuantitativeField>>>();
    const [secStat, setSecStat] = useState<Awaited<ReturnType<typeof profileQuantitativeField>>>();
    useEffect(() => {
        if (Array.isArray(computation)) {
            profileQuantitativeField(wrapComputationWithTag(computation[0], 'profiling'), field, dataset).then(setStat);
            profileQuantitativeField(wrapComputationWithTag(computation[1], 'profiling'), field, dataset).then(setSecStat);
        } else {
            profileQuantitativeField(wrapComputationWithTag(computation, 'profiling'), field, dataset).then(setStat);
        }
    }, [computation, field]);

    if (!isNotEmpty(stat)) {
        return <div className="h-24 flex items-center justify-center">Loading...</div>;
    }
    if (stat.min === stat.max) {
        return <div className="h-24 flex items-center justify-center text-xl">= {stat.min}</div>;
    }
    return (
        <div className="h-24 w-full flex flex-col space-y-1">
            <BinRenderer data={stat} extraData={secStat} />
            <div className="flex justify-between w-full text-xs font-medium leading-none">
                <div>{formatter(stat.min)}</div>
                <div>{formatter(stat.max)}</div>
            </div>
        </div>
    );
}

function BinRenderer({
    data,
    extraData,
}: {
    data: Awaited<ReturnType<typeof profileQuantitativeField>>;
    extraData?: Awaited<ReturnType<typeof profileQuantitativeField>>;
}) {
    const mediaTheme = useContext(themeContext);
    const { vizThemeConfig } = useContext(vegaThemeContext);

    const theme = getTheme({
        mediaTheme,
        vizThemeConfig,
    });

    const vegaConfig = useMemo(() => {
        const config: any = {
            ...theme,
            background: 'transparent',
        };
        return config;
    }, [theme]);

    const ref = useCallback(
        (node: HTMLDivElement) => {
            if (!node) {
                return;
            }
            const { width } = node.getBoundingClientRect();

            const getSpec = (d: typeof data, opacity = 0.96) => {
                return {
                    data: {
                        values: d.binValues.map(({ from, to, count }) => ({
                            value: `${formatter(from)} - ${formatter(to)}`,
                            from,
                            to,
                            count,
                        })),
                    },
                    mark: { type: 'bar', opacity, tooltip: { content: 'data' } },
                    encoding: {
                        x: {
                            field: 'from',
                            type: 'quantitative',
                            axis: false,
                            bin: {
                                binned: true,
                                step: (d.max - d.min) / 10,
                            },
                        },
                        x2: {
                            field: 'to',
                            type: 'quantitative',
                            axis: false,
                        },
                        y: {
                            field: 'count',
                            type: 'quantitative',
                            axis: false,
                        },
                        tooltip: [
                            { field: 'value', type: 'ordinal', title: 'Value' },
                            { field: 'count', type: 'quantitative', title: 'Count' },
                        ],
                    },
                };
            };
            const spec = {
                width: width - 10,
                height: 70,
                autosize: 'fit',
                ...(extraData ? { layer: [getSpec(data, 0.5), getSpec(extraData, 0.8)] } : getSpec(data)),
                config: { view: { stroke: null } },
            };
            embed(node, spec as unknown as VisualizationSpec, {
                renderer: 'canvas',
                mode: 'vega-lite',
                actions: false,
                config: vegaConfig,
                tooltip: {
                    theme: mediaTheme,
                },
            });
        },
        [data, extraData, vegaConfig]
    );
    return <div ref={ref} />;
}

function LazyLoaded<T>(Component: ComponentType<T>) {
    return function (props: T & { key?: React.Key }) {
        const [loaded, setLoaded] = useState(false);
        const obRef = useRef<IntersectionObserver>();
        const ref = useCallback((node: HTMLDivElement) => {
            obRef.current?.disconnect();
            if (node) {
                const observer = new IntersectionObserver((entries) => {
                    entries.forEach((entry) => {
                        if (entry.isIntersecting) {
                            setLoaded(true);
                            observer.disconnect();
                        }
                    });
                });
                observer.observe(node);
                obRef.current = observer;
            }
        }, []);
        return (
            <>
                {loaded && <Component {...props} />}
                <div className="w-0 h-0" ref={ref}></div>
            </>
        );
    };
}

function FieldProfilingElement(props: FieldProfilingProps & { semanticType: ISemanticType; displayOffset?: number; offset?: number }) {
    const { semanticType, displayOffset, offset, ...fieldProps } = props;
    switch (semanticType) {
        case 'nominal':
        case 'ordinal':
            return <NominalProfiling {...fieldProps} />;
        case 'temporal': {
            const formatter = (date: string | number) => formatDate(parsedOffsetDate(displayOffset, offset)(date));
            return <NominalProfiling {...fieldProps} valueRenderer={formatter} />;
        }
        case 'quantitative':
            return <QuantitativeProfiling {...fieldProps} />;
    }
}

export const FieldProfiling = LazyLoaded(FieldProfilingElement);
