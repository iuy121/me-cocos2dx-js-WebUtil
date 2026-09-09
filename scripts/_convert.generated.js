"use strict";
const COCOS_STUDIO_VERSION = '3.10.0.0';
function generateUUID() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }
const XML_INDENT = '  ';
        const COCOS_OBJECT_CTYPE_MAP = {
            LayerObjectData: 'GameLayerObjectData'
        };
        const PROPERTY_GROUP_TYPE_MAP = {
            LayerObjectData: 'Layer',
            GameLayerObjectData: 'Layer',
            SceneObjectData: 'Scene',
            NodeObjectData: 'Node'
        };
        const FRAME_CTYPE_MAP = {
            PointFrameData: 'PointFrame',
            ScaleFrameData: 'ScaleFrame',
            RotationSkewFrameData: 'RotationSkewFrame',
            ColorFrameData: 'ColorFrame',
            AlphaFrameData: 'AlphaFrame',
            TextureFrameData: 'TextureFrame',
            VisibleFrameData: 'VisibleFrame',
            EventFrameData: 'EventFrame',
            InnerActionFrameData: 'InnerActionFrame',
            AnchorPointFrameData: 'AnchorPointFrame',
            SizeFrameData: 'SizeFrame'
        };
        const ATTRIBUTE_ORDER = [
            'Name', 'CanEdit', 'ActionTag', 'VisibleForFrame', 'Tag', 'IconVisible',
            'PositionPercentXEnabled', 'PositionPercentYEnabled',
            'PercentWidthEnable', 'PercentHeightEnable',
            'PercentWidthEnabled', 'PercentHeightEnabled',
            'LeftMargin', 'RightMargin', 'TopMargin', 'BottomMargin',
            'TouchEnable', 'ClipAble', 'BackColorAlpha', 'ComboBoxIndex', 'ColorAngle',
            'FontSize', 'LabelText', 'ButtonText',
            'HorizontalAlignmentType', 'VerticalAlignmentType', 'OutlineSize',
            'Scale9Enable', 'LeftEage', 'RightEage', 'TopEage', 'BottomEage',
            'Scale9OriginX', 'Scale9OriginY', 'Scale9Width', 'Scale9Height',
            'ScrollDirectionType', 'ShadowOffsetX', 'ShadowOffsetY', 'ctype'
        ];
        const NODE_CHILD_ORDER = [
            'Size', 'Children', 'AnchorPoint', 'Position', 'Scale', 'RotationSkew',
            'CColor', 'PrePosition', 'PreSize',
            'TextColor', 'FontResource', 'FileData',
            'NormalFileData', 'PressedFileData', 'DisabledFileData',
            'OutlineColor', 'ShadowColor',
            'SingleColor', 'FirstColor', 'EndColor', 'ColorVector', 'InnerNodeSize'
        ];
        const CHILD_ELEMENT_KEYS = new Set(NODE_CHILD_ORDER);
        const INTEGER_ATTRIBUTE_KEYS = new Set([
            'ActionTag', 'Tag', 'FontSize', 'BackColorAlpha', 'ComboBoxIndex',
            'OutlineSize', 'Scale9OriginX', 'Scale9OriginY', 'Scale9Width',
            'Scale9Height', 'ScrollDirectionType', 'LeftEage', 'RightEage',
            'TopEage', 'BottomEage', 'Duration', 'FrameIndex', 'Type'
        ]);

        function repeatIndent(depth) {
            return XML_INDENT.repeat(depth);
        }

        function escapeXml(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }

        function formatFloat(value) {
            const numberValue = Number(value);
            if (!Number.isFinite(numberValue)) {
                return '0.0000';
            }
            return numberValue.toFixed(4);
        }

        function formatAttributeValue(key, value) {
            if (typeof value === 'boolean') {
                return value ? 'True' : 'False';
            }
            if (typeof value === 'number') {
                if (INTEGER_ATTRIBUTE_KEYS.has(key) && Number.isInteger(value)) {
                    return String(value);
                }
                return formatFloat(value);
            }
            return escapeXml(value);
        }

        function formatChildValue(key, value) {
            if (typeof value === 'boolean') {
                return value ? 'True' : 'False';
            }
            if (typeof value === 'number') {
                if (['A', 'R', 'G', 'B', 'Width', 'Height', 'Type'].includes(key)) {
                    return String(Math.round(value));
                }
                return formatFloat(value);
            }
            return escapeXml(value);
        }

        function createAttributeText(attributes) {
            return attributes
                .filter(attr => attr.value !== undefined && attr.value !== null)
                .map(attr => `${attr.name}="${formatAttributeValue(attr.name, attr.value)}"`)
                .join(' ');
        }

        function sortAttributes(attributeMap) {
            const result = [];
            const used = new Set();

            ATTRIBUTE_ORDER.forEach(key => {
                if (Object.prototype.hasOwnProperty.call(attributeMap, key)) {
                    result.push({ name: key, value: attributeMap[key] });
                    used.add(key);
                }
            });

            Object.keys(attributeMap).forEach(key => {
                if (!used.has(key)) {
                    result.splice(Math.max(result.length - 1, 0), 0, { name: key, value: attributeMap[key] });
                }
            });

            return result;
        }

        function getDefaultColor(elementName) {
            const defaults = {
                CColor: { A: 255, R: 255, G: 255, B: 255 },
                TextColor: { A: 255, R: 65, G: 65, B: 70 },
                OutlineColor: { A: 255, R: 255, G: 0, B: 0 },
                ShadowColor: { A: 255, R: 110, G: 110, B: 110 },
                SingleColor: { A: 255, R: 255, G: 150, B: 100 },
                FirstColor: { A: 255, R: 255, G: 150, B: 100 },
                EndColor: { A: 255, R: 250, G: 250, B: 255 }
            };
            return defaults[elementName] || {};
        }

        function getChildAttributes(elementName, value) {
            if (!value || typeof value !== 'object') {
                return [];
            }

            if (['CColor', 'TextColor', 'OutlineColor', 'ShadowColor', 'SingleColor', 'FirstColor', 'EndColor'].includes(elementName)) {
                const color = Object.assign({}, getDefaultColor(elementName), value);
                return ['A', 'R', 'G', 'B']
                    .filter(key => color[key] !== undefined)
                    .map(key => ({ name: key, value: color[key] }));
            }

            const orders = {
                Size: ['X', 'Y'],
                AnchorPoint: ['ScaleX', 'ScaleY'],
                Position: ['X', 'Y'],
                Scale: ['ScaleX', 'ScaleY'],
                RotationSkew: ['X', 'Y'],
                PrePosition: ['X', 'Y'],
                PreSize: ['X', 'Y'],
                ColorVector: ['ScaleX', 'ScaleY'],
                InnerNodeSize: ['Width', 'Height'],
                FileData: ['Type', 'Path', 'Plist'],
                NormalFileData: ['Type', 'Path', 'Plist'],
                PressedFileData: ['Type', 'Path', 'Plist'],
                DisabledFileData: ['Type', 'Path', 'Plist'],
                FontResource: ['Type', 'Path', 'Plist']
            };
            const order = orders[elementName] || Object.keys(value);
            const used = new Set();
            const attributes = [];

            order.forEach(key => {
                if (value[key] !== undefined && value[key] !== null) {
                    attributes.push({ name: key, value: value[key] });
                    used.add(key);
                }
            });
            Object.keys(value).forEach(key => {
                if (!used.has(key) && value[key] !== undefined && value[key] !== null) {
                    attributes.push({ name: key, value: value[key] });
                }
            });

            return attributes;
        }

        function createChildElement(elementName, value, depth) {
            const attributes = getChildAttributes(elementName, value)
                .map(attr => `${attr.name}="${formatChildValue(attr.name, attr.value)}"`)
                .join(' ');
            return `${repeatIndent(depth)}<${elementName}${attributes ? ' ' + attributes : ''} />`;
        }

        function getNodeCtype(node, isRoot) {
            const ctype = node.ctype || (isRoot ? 'LayerObjectData' : 'NodeObjectData');
            return isRoot ? (COCOS_OBJECT_CTYPE_MAP[ctype] || ctype) : ctype;
        }

        function createNodeAttributes(node, isRoot) {
            const attributeMap = {};

            Object.keys(node).forEach(key => {
                const value = node[key];
                if (key === 'Children' || key === 'Size' || CHILD_ELEMENT_KEYS.has(key)) {
                    return;
                }
                if (key === 'ButtonText' && value === '') {
                    return;
                }
                if (value !== null && typeof value !== 'object') {
                    attributeMap[key] = key === 'ctype' ? getNodeCtype(node, isRoot) : value;
                }
            });

            if (!attributeMap.Name && isRoot) {
                attributeMap.Name = 'Layer';
            }

            if (node.Scale9OriginX !== undefined) {
                const edge = Math.abs(Number(node.Scale9OriginX));
                attributeMap.LeftEage = edge;
                attributeMap.RightEage = edge;
            }
            if (node.Scale9OriginY !== undefined) {
                const edge = Math.abs(Number(node.Scale9OriginY));
                attributeMap.TopEage = edge;
                attributeMap.BottomEage = edge;
            }
            if (node.ColorVector && attributeMap.ColorAngle === undefined) {
                attributeMap.ColorAngle = 90;
            }

            attributeMap.ctype = getNodeCtype(node, isRoot);
            return sortAttributes(attributeMap);
        }

        function convertChildren(children, depth) {
            if (!Array.isArray(children) || children.length === 0) {
                return [];
            }

            const lines = [`${repeatIndent(depth)}<Children>`];
            children.forEach(child => {
                lines.push(...convertNodeToXml(child, depth + 1, false));
            });
            lines.push(`${repeatIndent(depth)}</Children>`);
            return lines;
        }

        function convertNodeToXml(node, depth, isRoot) {
            const tagName = isRoot ? 'ObjectData' : 'AbstractNodeData';
            const attributes = createAttributeText(createNodeAttributes(node, isRoot));
            const lines = [`${repeatIndent(depth)}<${tagName}${attributes ? ' ' + attributes : ''}>`];

            NODE_CHILD_ORDER.forEach(key => {
                if (key === 'Children') {
                    lines.push(...convertChildren(node.Children, depth + 1));
                    return;
                }
                if (node[key] !== undefined && node[key] !== null) {
                    lines.push(createChildElement(key, node[key], depth + 1));
                }
            });

            lines.push(`${repeatIndent(depth)}</${tagName}>`);
            return lines;
        }

        function getCocosContent(jsonData) {
            return (jsonData && jsonData.Content && jsonData.Content.Content)
                ? jsonData.Content.Content
                : (jsonData.Content || jsonData);
        }

        function convertAnimation(animation, depth) {
            const duration = animation && animation.Duration !== undefined ? animation.Duration : 0;
            const speed = animation && animation.Speed !== undefined ? animation.Speed : 1;
            const timelines = animation && Array.isArray(animation.Timelines) ? animation.Timelines : [];
            const attr = `Duration="${formatAttributeValue('Duration', duration)}" Speed="${formatFloat(speed)}"`;

            if (timelines.length === 0) {
                return [`${repeatIndent(depth)}<Animation ${attr} />`];
            }

            const lines = [`${repeatIndent(depth)}<Animation ${attr}>`];
            timelines.forEach(timeline => {
                lines.push(`${repeatIndent(depth + 1)}<Timeline ActionTag="${formatAttributeValue('ActionTag', timeline.ActionTag)}" Property="${escapeXml(timeline.Property || '')}">`);
                (timeline.Frames || []).forEach(frame => {
                    const frameTag = FRAME_CTYPE_MAP[frame.ctype] || frame.ctype || 'Frame';
                    const frameAttributes = Object.keys(frame)
                        .filter(key => key !== 'ctype' && key !== 'EasingData' && frame[key] !== null && typeof frame[key] !== 'object')
                        .map(key => `${key}="${formatAttributeValue(key, frame[key])}"`)
                        .join(' ');

                    if (frame.EasingData) {
                        lines.push(`${repeatIndent(depth + 2)}<${frameTag}${frameAttributes ? ' ' + frameAttributes : ''}>`);
                        const easingAttrs = getChildAttributes('EasingData', frame.EasingData)
                            .map(attr => `${attr.name}="${formatChildValue(attr.name, attr.value)}"`)
                            .join(' ');
                        lines.push(`${repeatIndent(depth + 3)}<EasingData${easingAttrs ? ' ' + easingAttrs : ''} />`);
                        lines.push(`${repeatIndent(depth + 2)}</${frameTag}>`);
                    } else {
                        lines.push(`${repeatIndent(depth + 2)}<${frameTag}${frameAttributes ? ' ' + frameAttributes : ''} />`);
                    }
                });
                lines.push(`${repeatIndent(depth + 1)}</Timeline>`);
            });
            lines.push(`${repeatIndent(depth)}</Animation>`);
            return lines;
        }

        // JSON 到 CSD 转换
        function convertJsonToCsdXml(jsonData, fileName) {
            if (!jsonData || typeof jsonData !== 'object') {
                throw new Error('JSON 数据为空或格式不正确');
            }

            const cocosContent = getCocosContent(jsonData);
            const objectData = cocosContent.ObjectData || jsonData.ObjectData;
            if (!objectData) {
                throw new Error('找不到 Content.Content.ObjectData，无法转换为 CSD');
            }

            const baseName = jsonData.Name || fileName.replace(/\.json$/i, '').replace(/\.csd$/i, '');
            const groupType = PROPERTY_GROUP_TYPE_MAP[objectData.ctype] || 'Layer';
            const projectId = jsonData.ID || objectData.ID || generateUUID();
            const lines = [
                '<GameFile>',
                `${repeatIndent(1)}<PropertyGroup Name="${escapeXml(baseName)}" Type="${groupType}" ID="${escapeXml(projectId)}" Version="${COCOS_STUDIO_VERSION}" />`,
                `${repeatIndent(1)}<Content ctype="GameProjectContent">`,
                `${repeatIndent(2)}<Content>`
            ];

            lines.push(...convertAnimation(cocosContent.Animation, 3));
            lines.push(...convertNodeToXml(objectData, 3, true));
            lines.push(`${repeatIndent(2)}</Content>`);
            lines.push(`${repeatIndent(1)}</Content>`);
            lines.push('</GameFile>');

            return lines.join('\n');
        }

        
module.exports = { convertJsonToCsdXml: convertJsonToCsdXml };
